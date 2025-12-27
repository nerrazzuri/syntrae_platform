from __future__ import annotations

from typing import Dict, Any, List, Optional, Tuple
import os
import re
import math
from dataclasses import dataclass


IntentType = str  # flexible catalog per-tenant


@dataclass
class IntentDecision:
    intent: IntentType
    confidence: float
    source: str
    contextual_trigger: bool
    tenant_overrides_used: bool
    details: Dict[str, Any]


class HybridContextualRouter:
    def __init__(self) -> None:
        # Default anchors; tenant overrides can extend
        self.default_catalog: Dict[str, List[str]] = {
            "lookup": ["what is", "who is", "find", "lookup"],
            "summary": ["summarize", "summary", "overview", "explain", "describe"],
            "aggregate": [
                "how many",
                "count",
                "total",
                "average",
                "sum",
                "mean",
                "median",
                "group by",
            ],
            "compare": ["compare", "versus", "vs", "difference between", "contrast"],
            "forecast": ["forecast", "predict", "projection", "estimate future"],
        }
        self.intent_model_name = os.getenv("INTENT_MODEL_NAME", "bge-small-en")
        self.intent_model_provider = os.getenv("INTENT_MODEL_PROVIDER", "remote")
        self.intent_conf_threshold = float(os.getenv("INTENT_CONF_THRESHOLD", "0.45"))
        self.intent_model_weight = float(os.getenv("INTENT_MODEL_WEIGHT", "0.35"))
        try:
            from ai_core.pipeline.embedding.embedding_service import EmbeddingService

            self._emb = EmbeddingService()
        except Exception:
            self._emb = None
        self._tenant_cache: Dict[str, Dict[str, Any]] = {}
        self._model_cache: Dict[str, Tuple[str, float]] = {}

    def _llm_disambiguate(self, q: str) -> Optional[str]:
        """Best-effort LLM disambiguation when all signals are weak.

        Returns one of: lookup | summary | compare | aggregate | forecast, or None on failure.
        """
        try:
            # Quick heuristic first to avoid LLM cost
            intent, score = self._rule_signal(q, self._load_tenant_catalog("default"))
            if intent:
                return intent
            # Fallback to LLM classification prompt via shared LLM client
            from ai_core.pipeline.llm.llm_client import LLMClient

            llm = LLMClient()
            prompt = (
                "Classify the user query into exactly one of these intents: "
                "lookup, summary, compare, aggregate, forecast.\n"
                "Respond with ONLY the label, no extra text."
            )
            out = llm.generate(
                query=prompt, contexts=[q], intent="summary", result_hint=None
            )
            text = (out.get("text") or out.get("response") or "").strip().lower()
            label = text.split()[0] if text else ""
            mapped = self._map_label(label)
            return mapped
        except Exception:
            # Last resort: embedding proxy
            try:
                intent, _ = self._embedding_signal(
                    q, self._load_tenant_catalog("default")
                )
                return intent
            except Exception:
                return None

    # ---------- Public API ----------
    def classify(
        self,
        query: str,
        conversation_context: List[Dict[str, Any]] | None,
        tenant_id: str,
        user_id: str,
    ) -> IntentDecision:
        q = (query or "").strip()
        # Load tenant intents
        catalog = self._load_tenant_catalog(tenant_id)
        # Signals
        rule_intent, rule_score = self._rule_signal(q, catalog)
        emb_intent, emb_score = self._embedding_signal(q, catalog)
        (
            ctx_intent,
            ctx_score,
            ctx_trigger,
            ctx_match,
            prev_intent,
        ) = self._context_signal(q, conversation_context)
        # model decided conditionally later
        model_intent, model_score, model_reason = None, 0.0, None

        # Weighted aggregation
        weights = {
            "rule": 0.30,
            "emb": 0.25,
            "ctx": 0.25,
            "model": self.intent_model_weight,
        }
        candidates: Dict[str, float] = {}

        def acc(k: Optional[str], s: float, w: float):
            if not k:
                return
            candidates[k] = candidates.get(k, 0.0) + max(0.0, s) * w

        # If a continuation trigger exists and rule suggests a different explicit intent, the rule overrides inheritance
        acc(rule_intent, rule_score, weights["rule"])
        acc(emb_intent, emb_score, weights["emb"])
        # Boost context score based on embedding match when available
        boosted_ctx = ctx_score
        if ctx_trigger and ctx_match is not None and ctx_match >= 0.6:
            # Boost between +0.15 and +0.25 scaled by similarity
            boost = min(0.25, max(0.15, (ctx_match - 0.6) * 0.5 + 0.15))
            boosted_ctx = min(1.0, boosted_ctx + boost)
        acc(ctx_intent, boosted_ctx, weights["ctx"])
        # preliminary combined confidence
        prelim_conf = max(candidates.values()) if candidates else 0.0
        if prelim_conf < self.intent_conf_threshold:
            model_intent, model_score, model_reason = self._model_signal_conditional(
                q, tenant_id, prev_intent
            )
            acc(model_intent, model_score, weights["model"])
        if not candidates:
            final_intent, final_conf = "lookup", 0.35
        else:
            final_intent, final_conf = max(candidates.items(), key=lambda x: x[1])

        # Low-confidence disambiguation via LLM if configured
        if final_conf < 0.35:
            llm_out = self._llm_disambiguate(q)
            if llm_out:
                final_intent = llm_out
                final_conf = 0.36

        decision = IntentDecision(
            intent=final_intent,
            confidence=float(min(1.0, max(0.0, final_conf))),
            source=self._best_source(rule_score, emb_score, ctx_score, model_score),
            contextual_trigger=bool(ctx_trigger),
            tenant_overrides_used=bool(
                self._tenant_cache.get(tenant_id, {}).get("overrides", False)
            ),
            details={
                "rule": {"intent": rule_intent, "score": rule_score},
                "embedding": {"intent": emb_intent, "score": emb_score},
                "context": {
                    "intent": ctx_intent,
                    "score": boosted_ctx,
                    "match": ctx_match,
                    "prev_intent": prev_intent,
                    "trigger": ctx_trigger,
                },
                "model": {
                    "intent": model_intent,
                    "score": model_score,
                    "reason": model_reason,
                },
            },
        )
        # Structured diagnostics logging
        try:
            from shared.logging.pipeline_logger import PipelineLogger

            PipelineLogger(tenant_id).emit(
                {
                    "router": {
                        "previous_intent": prev_intent,
                        "context_match_score": ctx_match,
                        "continuation_trigger_detected": bool(ctx_trigger),
                        "final_intent": final_intent,
                        "confidence": decision.confidence,
                    }
                }
            )
        except Exception:
            pass
        # Persist last decision to tenant cache for quick context similarity checks
        self._tenant_cache.setdefault(tenant_id, {})["last_decision"] = decision
        # Emit intent confidence metric
        try:
            from shared.metrics.quality_metrics import quality_metrics

            quality_metrics.set_intent_conf(tenant_id, decision.confidence)
        except Exception:
            pass
        return decision

    # ---------- Signals ----------
    def _rule_signal(
        self, q: str, catalog: Dict[str, List[str]]
    ) -> Tuple[Optional[str], float]:
        ql = q.lower()
        for intent, phrases in catalog.items():
            for p in phrases:
                if re.search(r"\b" + re.escape(p) + r"\b", ql):
                    return intent, 1.0
        return None, 0.0

    def _embedding_signal(
        self, q: str, catalog: Dict[str, List[str]]
    ) -> Tuple[Optional[str], float]:
        if not self._emb:
            return None, 0.0
        intents = list(catalog.keys())
        phrases = [" ".join(catalog[i]) for i in intents]
        try:
            qv = self._emb.embed_query(q, "default")
            if not qv:
                return None, 0.0
            best, best_s = None, -1.0
            for i, p in enumerate(phrases):
                pv = self._emb.embed_query(p, "default")
                if not pv:
                    continue
                s = self._cos(qv, pv)
                if s > best_s:
                    best, best_s = intents[i], s
            return (best, float(best_s)) if best else (None, 0.0)
        except Exception:
            return None, 0.0

    def _context_signal(
        self, q: str, recent: Optional[List[Dict[str, Any]]]
    ) -> Tuple[Optional[str], float, bool, Optional[float], Optional[str]]:
        if not recent:
            return None, 0.0, False, None, None
        ql = q.lower()
        # Detect continuation cues
        pronouns = r"\b(this|that|those|these|it|same)\b"
        comparative = r"\b(now\s+compare|how\s+about|what\s+about|compare\s+to|versus|vs|difference)\b"
        continuity = r"\b(continue|summarize\s+that|give\s+me\s+the\s+rest|carry\s+on|keep\s+going)\b"
        trigger = bool(re.search(pronouns + "|" + comparative + "|" + continuity, ql))
        # Previous intent from most recent message with decision meta
        prev_intent = None
        for m in recent:
            if isinstance(m, dict) and m.get("meta", {}).get("intent_decision"):
                prev_intent = m["meta"]["intent_decision"].get("intent")
                if prev_intent:
                    break
        # Continuation mapping
        cont_map = {
            "summary": "summary",
            "compare": "compare",
            "aggregate": "aggregate",
            "lookup": "lookup",
        }
        inherited = cont_map.get(prev_intent) if prev_intent else None
        # Embedding similarity to last few messages
        match_score = None
        try:
            if self._emb:
                prev_texts = [
                    str(m.get("content", "")) for m in recent[:3] if isinstance(m, dict)
                ]
                joined = " \n".join(prev_texts)
                qv = self._emb.embed_query(q, "default")
                pv = self._emb.embed_query(joined, "default")
                if qv and pv:
                    match_score = self._cos(qv, pv)
        except Exception:
            match_score = None
        # Base context score
        if inherited and trigger:
            base = 0.7
        elif inherited and (match_score is not None and match_score >= 0.75):
            base = 0.5
            trigger = True
        else:
            return None, 0.0, False, match_score, prev_intent
        return inherited, base, True, match_score, prev_intent

    def _model_signal_conditional(
        self, q: str, tenant_id: str, prev_intent: Optional[str]
    ) -> Tuple[Optional[str], float, Optional[str]]:
        if os.getenv("USE_INTENT_MODEL", "false").lower() not in ("1", "true", "yes"):
            return None, 0.0, None
        key = f"{tenant_id}::{q.strip().lower()}"
        if key in self._model_cache:
            intent, conf = self._model_cache[key]
            return intent, float(conf), None
        context = {"tenant_id": tenant_id, "prev_intent": prev_intent}
        import time as _t

        t0 = _t.time()
        label, conf, reason = None, 0.0, None
        err = None
        for _ in range(2):
            try:
                label, conf, reason = self.predict_intent_via_model(q, context)
                break
            except Exception as e:
                err = e
        latency = int((_t.time() - t0) * 1000)
        try:
            from shared.logging.pipeline_logger import PipelineLogger

            PipelineLogger(tenant_id).emit(
                {
                    "router_model": {
                        "invoked": True,
                        "provider": self.intent_model_provider,
                        "confidence": conf,
                        "latency_ms": latency,
                        "error": str(err) if err else None,
                        "label": label,
                    }
                }
            )
        except Exception:
            pass
        mapped = self._map_label(label)
        if mapped is None:
            return None, 0.0, reason
        self._model_cache[key] = (mapped, float(conf))
        return mapped, float(conf), reason

    def predict_intent_via_model(
        self, query: str, context: Dict[str, Any]
    ) -> Tuple[Optional[str], float, Optional[str]]:
        provider = (self.intent_model_provider or "remote").lower()
        if provider == "remote":
            try:
                from openai import OpenAI
                from shared.security.secret_manager import secret_manager

                tenant_id = str(context.get("tenant_id") or "")
                api_key = None
                if tenant_id:
                    api_key = secret_manager.get_tenant_secret(tenant_id, "OPENAI_API_KEY")
                api_key = api_key or secret_manager.get("OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY")
                client = OpenAI(api_key=api_key) if api_key else None
                if not client:
                    raise RuntimeError("OpenAI client not configured")
                prompt = (
                    "Classify the intent of the user query into one label from: "
                    "[lookup, summary, compare, aggregate, forecast]. "
                    "Return a JSON object with keys 'intent' and 'confidence' (0-1).\n\n"
                    f"tenant_id: {context.get('tenant_id')} prev_intent: {context.get('prev_intent')}\n"
                    f"query: {query}"
                )
                resp = client.chat.completions.create(
                    model=os.getenv("INTENT_MODEL_REMOTE_NAME", "gpt-4o-mini"),
                    temperature=0.0,
                    messages=[{"role": "user", "content": prompt}],
                )
                text = (resp.choices[0].message.content or "").strip()
                import json as _json

                data = (
                    _json.loads(text)
                    if text.startswith("{")
                    else {"intent": text.strip().lower(), "confidence": 0.6}
                )
                return data.get("intent"), float(data.get("confidence", 0.6)), None
            except Exception:
                return self._local_model_stub(query, context)
        else:
            return self._local_model_stub(query, context)

    def _local_model_stub(
        self, query: str, context: Dict[str, Any]
    ) -> Tuple[Optional[str], float, Optional[str]]:
        intent, score = self._embedding_signal(
            query, self._load_tenant_catalog(context.get("tenant_id", "default"))
        )
        return intent, float(score), "embedding-proxy"

    @staticmethod
    def _map_label(label: Optional[str]) -> Optional[str]:
        if not label:
            return None
        l = label.strip().lower()
        mapping = {
            "lookup": "lookup",
            "summarize": "summary",
            "summary": "summary",
            "compare": "compare",
            "aggregate": "aggregate",
            "count": "aggregate",
            "forecast": "forecast",
        }
        return mapping.get(l, l if l in mapping.values() else None)

    # ---------- Utilities ----------
    @staticmethod
    def _best_source(
        rule_score: float, emb_score: float, ctx_score: float, model_score: float
    ) -> str:
        try:
            pairs = [
                ("rule", float(rule_score or 0.0)),
                ("embedding", float(emb_score or 0.0)),
                ("context", float(ctx_score or 0.0)),
                ("model", float(model_score or 0.0)),
            ]
            best = max(pairs, key=lambda x: x[1])
            # If all zero, return "rule" as default
            return best[0] if best[1] > 0.0 else "rule"
        except Exception:
            return "rule"

    def _load_tenant_catalog(self, tenant_id: str) -> Dict[str, List[str]]:
        # Load from cache or merge default with per-tenant overrides from JSON
        cached = self._tenant_cache.get(tenant_id)
        if cached and cached.get("catalog"):
            return cached["catalog"]
        cat = {k: list(v) for k, v in self.default_catalog.items()}
        overrides_used = False
        try:
            import json
            from pathlib import Path

            base_dir = os.getenv("INTENT_CATALOG_DIR", "data/intent_catalog")
            path = Path(base_dir) / f"{tenant_id}.json"
            if path.is_file():
                with path.open("r", encoding="utf-8") as f:
                    tenant_cat = json.load(f)
                if isinstance(tenant_cat, dict):
                    for intent, phrases in tenant_cat.items():
                        if isinstance(intent, str) and isinstance(phrases, list):
                            # extend or create
                            cat.setdefault(intent, [])
                            for p in phrases:
                                if isinstance(p, str) and p and p not in cat[intent]:
                                    cat[intent].append(p)
                    overrides_used = True
        except Exception:
            overrides_used = False
        self._tenant_cache.setdefault(tenant_id, {})["catalog"] = cat
        self._tenant_cache[tenant_id]["overrides"] = overrides_used
        return cat

    @staticmethod
    def _cos(a: List[float], b: List[float]) -> float:
        if not a or not b:
            return 0.0
        num = sum(x * y for x, y in zip(a, b))
        da = math.sqrt(sum(x * x for x in a)) or 1.0
        db = math.sqrt(sum(y * y for y in b)) or 1.0
        return num / (da * db)

    @staticmethod
    def _jaccard(a: str, b: str) -> float:
        sa = set(a.split())
        sb = set(b.split())
        if not sa or not sb:
            return 0.0
        return len(sa & sb) / float(len(sa | sb))
