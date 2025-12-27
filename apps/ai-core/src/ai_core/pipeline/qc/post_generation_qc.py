from typing import List, Dict, Any, Optional

import re
from shared.config.tuning import qc


class PostGenerationQC:
    def __init__(self) -> None:
        pass

    def confidence(self, output: str, contexts: List[str]) -> float:
        # Approximate copy-detection by character-level Jaccard on shingles
        if not output or not contexts:
            return 0.0

        def shingles(s: str, k: int = 8) -> set:
            s = s.lower()
            return {s[i : i + k] for i in range(max(0, len(s) - k + 1))}

        out_set = shingles(output)
        ctx_set = set()
        for c in contexts[:3]:
            ctx_set |= shingles(c)
        inter = len(out_set & ctx_set)
        union = len(out_set | ctx_set) or 1
        sim = inter / union
        # Convert to a confidence proxy (higher when not copy-paste but still overlapping):
        return 1.0 - sim

    def _rewrite_with_directive(
        self,
        llm_client,
        base_query: str,
        directive: str,
        contexts: List[Any],
        intent: str,
        result_hint: Optional[str],
    ) -> Dict[str, Any]:
        # Preserve original intent and reinforce honoring of result_hint
        reinforced = f"{base_query}\n\n{directive}\nIf a structured result summary is provided, honor it exactly."
        return llm_client.generate(
            reinforced, contexts, intent=intent, result_hint=result_hint
        )

    def run(
        self,
        llm_client,
        payload: Dict[str, Any],
        query: str,
        contexts: List[Any],
        intent: str,
        result_hint: Optional[str],
        meta: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        # Normalize payload API contract
        if "response" not in payload and "text" in payload:
            payload["response"] = payload.get("text", "")
        text = (payload.get("response") or "").strip()
        ctx_texts = [c if isinstance(c, str) else c.get("text", "") for c in contexts]
        # Style/copy metric only (not a driver for rewrite)
        conf = self.confidence(text, ctx_texts)
        rewrite_used = False
        rewrite_count = 0
        tenant_id = (meta or {}).get("tenant_id", "global")
        model_name = (meta or {}).get("model", "unknown")
        # Collect valid snippet IDs for orphan cleanup
        valid_ids: List[str] = []
        try:
            valid_ids = [
                str(c.get("id")).strip()
                for c in contexts
                if isinstance(c, dict) and c.get("id")
            ]
        except Exception:
            valid_ids = []
        # Citation enforcement: require [S#] when contexts exist
        has_context = bool(contexts)
        has_citation = bool(re.search(r"\[S\d+\]", text)) if text else False
        if has_context and not has_citation and rewrite_count < qc.rewrite_max_attempts:
            regen = self._rewrite_with_directive(
                llm_client,
                query,
                "Add the correct snippet IDs after facts per the provided context; do not change substance.",
                contexts,
                intent,
                result_hint,
            )
            rewrite_count += 1
            txt2 = (regen.get("text") or "").strip()
            if txt2:
                text = txt2
                payload["response"] = txt2
                rewrite_used = True
        # Citation coverage warning and threshold by intent
        # Orphan tag cleanup
        if valid_ids:
            text, orphan_rate = self._drop_orphan_tags(text, set(valid_ids))
            payload["response"] = text
        else:
            orphan_rate = 0.0
        coverage = self._citation_coverage(text)
        min_ratio = (
            qc.citation_min_ratio_lookup
            if intent == "lookup"
            else (
                qc.citation_min_ratio_compare
                if intent == "compare"
                else qc.citation_min_ratio_summary
            )
        )
        # Hallucination heuristic: words not in context vocabulary
        hall_score = self._hallucination_score(text, ctx_texts)
        # Length control
        if self._token_estimate(text) > qc.max_answer_tokens:
            text = self._summarize_text(text)
            payload["response"] = text
            # After truncation, re-check coverage and try one add-tags pass if budget remains
            coverage = self._citation_coverage(text)
            if (
                has_context
                and coverage < min_ratio
                and rewrite_count < qc.rewrite_max_attempts
            ):
                regen = self._rewrite_with_directive(
                    llm_client,
                    query,
                    "Add the correct snippet IDs after facts per the provided context; do not change substance.",
                    contexts,
                    intent,
                    result_hint,
                )
                rewrite_count += 1
                txt2 = (regen.get("text") or "").strip()
                if txt2:
                    payload["response"] = txt2
                    text = txt2
                    rewrite_used = True
        # Compliance filters
        if qc.remove_disclaimers:
            text = re.sub(r"(?i)i am an ai language model.*?\.?\s*", "", text)
            payload["response"] = text
        if qc.tenant_policy_footer:
            payload["response"] = (
                payload["response"] + "\n\n" + qc.tenant_policy_footer
            ).strip()
        # Validate URLs or titles without [S#]
        if has_context:
            raw_urls = re.findall(r"https?://\S+", text)
            bare_titles = re.findall(r"NPR\s*\d+\.[^\[]+", text)
            needs_rewrite = False
            if raw_urls and not re.search(r"\[S\d+\]", text):
                needs_rewrite = True
            if bare_titles and not re.search(r"\[S\d+\]", text):
                needs_rewrite = True
            if needs_rewrite and rewrite_count < qc.rewrite_max_attempts:
                regen = self._rewrite_with_directive(
                    llm_client,
                    query,
                    "Append correct [S#] tags after any factual statements, URLs, or document mentions; do not change substance.",
                    contexts,
                    intent,
                    result_hint,
                )
                rewrite_count += 1
                txt2 = (regen.get("text") or "").strip()
                if txt2:
                    payload["response"] = txt2
                    text = txt2
                    rewrite_used = True
        # Minimal rewrite on serious issues
        serious = (coverage < min_ratio) or (hall_score > qc.hallucination_max_score)
        if serious and rewrite_count < qc.rewrite_max_attempts:
            regen = self._rewrite_with_directive(
                llm_client,
                query,
                "Fix citation IDs and correct factual errors using only provided snippets; do not change substance.",
                contexts,
                intent,
                result_hint,
            )
            rewrite_count += 1
            txt2 = (regen.get("text") or "").strip()
            if txt2:
                payload["response"] = txt2
                rewrite_used = True
        # Log citation coverage metrics
        try:
            from shared.logging.pipeline_logger import PipelineLogger

            PipelineLogger(tenant_id).emit(
                {
                    "citations": {
                        "ids_present": re.findall(r"\[S\d+\]", text),
                        "coverage": coverage,
                        "hallucination_score": hall_score,
                        "orphan_rate": orphan_rate,
                        "rewrite_count": rewrite_count,
                        "met_threshold": coverage >= min_ratio,
                    }
                }
            )
        except Exception:
            pass
        payload["qc_status"] = {
            "confidence": float(conf),
            "rewrite_used": bool(rewrite_used),
            "citation_coverage": float(coverage),
            "hallucination_score": float(hall_score),
            "orphan_rate": float(orphan_rate),
            "rewrite_count": int(rewrite_count),
        }
        return payload

    def _citation_coverage(self, text: str) -> float:
        sents = [s for s in re.split(r"[.!?]", text or "") if s.strip()]
        cited = [s for s in sents if re.search(r"\[S\d+\]", s)]
        return len(cited) / (len(sents) or 1)

    def _hallucination_score(self, text: str, ctx_texts: List[str]) -> float:
        # Very rough heuristic: percentage of content words absent from context vocab
        tv = set(re.findall(r"[a-zA-Z0-9]+", (" ".join(ctx_texts)).lower()))
        words = [w.lower() for w in re.findall(r"[a-zA-Z0-9]+", text)]
        content = [w for w in words if len(w) > 3]
        if not content:
            return 0.0
        missing = [w for w in content if w not in tv]
        return min(1.0, len(missing) / len(content))

    def _token_estimate(self, text: str) -> int:
        return int(len(text) / 4)

    def _summarize_text(self, text: str) -> str:
        # Simple compression: keep first 4-6 sentences
        sents = [s.strip() for s in re.split(r"[.!?]", text) if s.strip()]
        kept = sents[:6]
        return ". ".join(kept) + ("." if kept else "")

    def _drop_orphan_tags(self, text: str, valid_ids: set) -> (str, float):
        tags = re.findall(r"\[(S\d+)\]", text)
        if not tags:
            return text, 0.0
        total = len(tags)
        orphans = 0

        def tag_replacer(m):
            nonlocal orphans
            tg = m.group(1)
            if tg in valid_ids:
                return f"[{tg}]"
            orphans += 1
            return ""

        new_text = re.sub(r"\[(S\d+)\]", tag_replacer, text)
        rate = orphans / float(total or 1)
        return new_text, rate
