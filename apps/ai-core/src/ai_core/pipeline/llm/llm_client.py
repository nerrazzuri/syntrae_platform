from typing import List, Optional, Dict, Any
import os
from openai import OpenAI
from shared.security.secret_manager import secret_manager

from shared.config.tuning import cost as cost_cfg
from ai_core.pipeline.llm.prompt_orchestrator import PromptOrchestrator
from shared.utils.retry import retry_with_backoff
from shared.utils.circuit_breaker import circuit_breaker
from shared.queue.retry_queue import retry_queue
from shared.cache.generation_cache import generation_cache
from shared.metrics.cost_metrics import cost_metrics
from shared.metrics.cost_aggregator import rolling_cost


class LLMClient:
    def __init__(self) -> None:
        api_key = secret_manager.get("OPENAI_API_KEY")
        self.client = OpenAI(api_key=api_key) if api_key else None
        self._tenant_clients: Dict[str, OpenAI] = {}
        self.model = os.getenv("LLM_MODEL") or os.getenv(
            "RAG_CHAT_MODEL", "gpt-4o-mini"
        )
        self.temperature = float(os.getenv("RAG_CHAT_TEMPERATURE", "0.3"))
        self._orchestrator = PromptOrchestrator()
        self._system_policy = (
            "You are Omni, a concise, factual enterprise assistant. Answer based only on provided context. "
            "If the answer is unknown in context, say so. Use [S#] tags to cite snippets after facts. "
            "Do not reveal chain-of-thought or internal reasoning."
        )

    def generate(
        self,
        query: str,
        contexts: List[str],
        intent: str = "lookup",
        result_hint: str | None = None,
        tenant_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        # Choose client: prefer per-tenant BYO key when available
        client = self.client
        try:
            if tenant_id:
                tkey = secret_manager.get_tenant_secret(tenant_id, "OPENAI_API_KEY")
                if tkey:
                    if tenant_id not in self._tenant_clients:
                        self._tenant_clients[tenant_id] = OpenAI(api_key=tkey)
                    client = self._tenant_clients[tenant_id]
        except Exception:
            pass
        prompt = self._orchestrator.build_prompt(
            intent=intent,
            query=query,
            context_docs=contexts or [],
            result_hint=result_hint,
        )
        # Cache lookup
        if tenant_id:
            cached = generation_cache.get(tenant_id, self.model, prompt)
            if cached:
                cost_metrics.hit(tenant_id, "gen")
                return {
                    "text": cached.get("text", ""),
                    "used": cached.get("used", False),
                }
            else:
                cost_metrics.miss(tenant_id, "gen")
        if not client:
            # Local heuristic summarization fallback (no external calls)
            text = self._local_summarize(
                contexts or [result_hint or ""], intent=intent, result_hint=result_hint
            )
            return {"text": text, "used": False}
        if not circuit_breaker.allow("openai_chat", tenant_id=None):
            text = self._local_summarize(
                contexts or [result_hint or ""], intent=intent, result_hint=result_hint
            )
            return {"text": text, "used": False}

        @retry_with_backoff("openai.chat")
        def _do_chat() -> dict:
            completion = client.chat.completions.create(
                model=self.model,
                temperature=self.temperature,
                messages=[
                    {"role": "system", "content": self._system_policy},
                    {"role": "user", "content": prompt},
                ],
            )
            return {
                "text": (completion.choices[0].message.content or "").strip(),
                "usage": getattr(completion, "usage", None),
            }

        try:
            out = _do_chat()
            text = out.get("text", "")
            circuit_breaker.record_success("openai_chat", tenant_id=None)
            # Token/cost accounting
            try:
                usage = out.get("usage") or {}
                prompt_tokens = int(getattr(usage, "prompt_tokens", 0) or 0)
                completion_tokens = int(getattr(usage, "completion_tokens", 0) or 0)
            except Exception:
                prompt_tokens = int(len(self._system_policy) / 4 + len(prompt) / 4)
                completion_tokens = int(len(text) / 4)
            # Compute cost
            m = self.model
            in_rate = float(
                cost_cfg.model_in_usd_per_1k.get(
                    m, cost_cfg.model_in_usd_per_1k.get("default", 0.003)
                )
            )
            out_rate = float(
                cost_cfg.model_out_usd_per_1k.get(
                    m, cost_cfg.model_out_usd_per_1k.get("default", 0.006)
                )
            )
            usd = (prompt_tokens / 1000.0) * in_rate + (
                completion_tokens / 1000.0
            ) * out_rate
            if tenant_id:
                cost_metrics.record_tokens(
                    tenant_id, m, "chat", prompt_tokens, completion_tokens, usd
                )
                rolling_cost.add(
                    tenant_id, m, "chat", prompt_tokens, completion_tokens, usd
                )
                # Cache store
                try:
                    generation_cache.set(
                        tenant_id, self.model, prompt, {"text": text, "used": True}
                    )
                except Exception:
                    pass
            try:
                from shared.logging.pipeline_logger import PipelineLogger

                PipelineLogger("global").emit(
                    {
                        "llm_call": {
                            "template": intent,
                            "system_tokens": int(len(self._system_policy) / 4),
                            "user_tokens": int(len(prompt) / 4),
                            "has_result_hint": bool(result_hint),
                        }
                    }
                )
            except Exception:
                pass
            return {"text": text, "used": True}
        except Exception as e:
            circuit_breaker.record_failure("openai_chat", tenant_id=None)
            text = self._local_summarize(
                contexts or [result_hint or ""], intent=intent, result_hint=result_hint
            )
            # enqueue failed chat for diagnostics/future replay
            try:
                retry_queue.enqueue(
                    "llm_generate",
                    tenant_id="global",
                    payload={"intent": intent, "has_ctx": bool(contexts)},
                    last_error=str(e),
                )
            except Exception:
                pass
            return {"text": text, "used": False}

    def _local_summarize(
        self, contexts: List[str], intent: str, result_hint: str | None
    ) -> str:
        joined = " ".join(contexts[:3])
        # Split into sentences and keep top few
        parts = [p.strip() for p in joined.replace("\n", " ").split(".") if p.strip()]
        if intent == "summary":
            kept = parts[:5]
        elif intent == "lookup":
            kept = parts[:2]
        elif intent == "compare":
            kept = parts[:6]
        elif intent == "aggregate" and result_hint:
            return str(result_hint)
        else:
            kept = parts[:4]
        return ". ".join(kept) + ("." if kept else "")
