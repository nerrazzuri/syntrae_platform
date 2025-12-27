from typing import List, Optional

import os
from openai import OpenAI
from shared.security.secret_manager import secret_manager

from shared.cache.redis import redis_cache
from shared.config.tuning import retrieval, cost as cost_cfg
from shared.utils.retry import retry_with_backoff
from shared.utils.circuit_breaker import circuit_breaker
from shared.queue.retry_queue import retry_queue
from shared.metrics.cost_metrics import cost_metrics
from shared.metrics.cost_aggregator import rolling_cost
from shared.throttling.quota import throttle
from shared.config.tuning import retries
import hashlib
import logging


class EmbeddingService:
    def __init__(self) -> None:
        api_key = secret_manager.get("OPENAI_API_KEY")
        self.client = OpenAI(api_key=api_key) if api_key else None
        self._tenant_clients: dict[str, OpenAI] = {}
        self.model = getattr(
            retrieval,
            "embedding_model",
            os.getenv("RAG_EMBED_MODEL", "text-embedding-3-large"),
        )
        self._logger = logging.getLogger(__name__)

    def _ensure_client(self) -> None:
        if self.client is None:
            try:
                api_key = secret_manager.get("OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY")
                if api_key:
                    self.client = OpenAI(api_key=api_key)
            except Exception as e:
                self._logger.error(f"Embedding client init failed: {e}")

    def _cache_key(self, text: str) -> str:
        digest = hashlib.sha256((text or "").encode("utf-8")).hexdigest()
        return f"emb:{self.model}:{digest}"

    def embed_query(self, query: str, tenant_id: str) -> Optional[List[float]]:
        if not query:
            return None
        # Lazy init to avoid early-return bugs
        self._ensure_client()
        if not self.client:
            self._logger.error("Embedding client unavailable; skipping embed")
            return None
        # Prefer per-tenant BYO client if configured
        try:
            if tenant_id:
                tkey = secret_manager.get_tenant_secret(tenant_id, "OPENAI_API_KEY")
                if tkey:
                    if tenant_id not in self._tenant_clients:
                        self._tenant_clients[tenant_id] = OpenAI(api_key=tkey)
                    self_client = self._tenant_clients[tenant_id]
                else:
                    self_client = self.client
            else:
                self_client = self.client
        except Exception:
            self_client = self.client
        k = self._cache_key(query)
        cached = redis_cache.get_tenant_key(tenant_id, k)
        if isinstance(cached, list):
            try:
                cost_metrics.hit(tenant_id, "emb")
            except Exception:
                pass
            return cached
        else:
            try:
                cost_metrics.miss(tenant_id, "emb")
            except Exception:
                pass

        if not circuit_breaker.allow("openai_embed", tenant_id):
            # Degrade to None, let caller choose fallback
            return None

        # Throttling
        try:
            # TODO: optionally load tenant tier from DB if available; default BASIC
            ok = throttle.acquire(tenant_id, kind="embed", tenant_tier=None)
            if not ok:
                return None
        except Exception:
            pass

        @retry_with_backoff("openai.embed")
        def _do_embed() -> Optional[List[float]]:
            resp = self_client.embeddings.create(model=self.model, input=[query])
            vec = resp.data[0].embedding if resp and resp.data else None
            # Token/cost accounting (OpenAI embeds may not return usage; estimate)
            try:
                usage = getattr(resp, "usage", None)
                ptoks = int(getattr(usage, "prompt_tokens", 0) or 0)
            except Exception:
                # rough estimate
                ptoks = int(len(query) / 4)
            m = self.model
            in_rate = float(
                cost_cfg.model_in_usd_per_1k.get(
                    m, cost_cfg.model_in_usd_per_1k.get("default", 0.0001)
                )
            )
            usd = (ptoks / 1000.0) * in_rate
            cost_metrics.record_tokens(tenant_id, m, "embed", ptoks, 0, usd)
            rolling_cost.add(tenant_id, m, "embed", ptoks, 0, usd)
            return vec if isinstance(vec, list) else None

        try:
            vec = _do_embed()
            if vec:
                redis_cache.set_tenant_key(tenant_id, k, vec, ttl=1800)
                circuit_breaker.record_success("openai_embed", tenant_id)
                try:
                    throttle.release(tenant_id, kind="embed")
                except Exception:
                    pass
                return vec
            # No vec -> treat as failure path
            circuit_breaker.record_failure("openai_embed", tenant_id)
        except Exception as e:  # noqa: BLE001
            circuit_breaker.record_failure("openai_embed", tenant_id)
            # enqueue for async retry (best-effort)
            if hasattr(retries, "queue_enabled") and retries.queue_enabled:
                try:
                    retry_queue.enqueue(
                        job_type="embed_query",
                        tenant_id=tenant_id,
                        payload={"query": query, "model": self.model},
                        last_error=str(e),
                    )
                except Exception:
                    pass
        finally:
            try:
                throttle.release(tenant_id, kind="embed")
            except Exception as e:
                logging.getLogger(__name__).exception(
                    "[embedding.throttle_release] error", extra={"tenant_id": tenant_id}
                )
        return None

    # Batch embedding with caching for synonym/column vectors
    def embed_texts_with_cache(
        self, texts: List[str], tenant_id: str
    ) -> List[List[float]]:
        if not texts:
            return []
        if not self.client:
            return [[] for _ in texts]
        # Prepare cache lookups
        keys = [self._cache_key(t or "") for t in texts]
        results: List[Optional[List[float]]] = []
        to_compute: List[int] = []
        for i, k in enumerate(keys):
            cached = redis_cache.get_tenant_key(tenant_id, k)
            if isinstance(cached, list):
                results.append(cached)
                try:
                    cost_metrics.hit(tenant_id, "emb")
                except Exception:
                    pass
            else:
                results.append(None)
                to_compute.append(i)
                try:
                    cost_metrics.miss(tenant_id, "emb")
                except Exception:
                    pass
        if not to_compute:
            return [list(v or []) for v in results]  # type: ignore
        # Respect circuit breaker (tenant-aware) for batch call
        if not circuit_breaker.allow("openai_embed", tenant_id):
            return [list(v or []) for v in results]  # degrade to partial cache hits
        # Throttling by tenant
        try:
            ok = throttle.acquire(tenant_id, kind="embed", tenant_tier=None)
            if not ok:
                return [list(v or []) for v in results]
        except Exception:
            pass
        # Perform batch embedding for only the missing indices
        batch_inputs = [texts[i] for i in to_compute]

        @retry_with_backoff("openai.embed.batch")
        def _do_batch() -> List[List[float]]:
            resp = self_client.embeddings.create(model=self.model, input=batch_inputs)
            out = []
            if resp and getattr(resp, "data", None):
                for item in resp.data:
                    vec = getattr(item, "embedding", [])
                    out.append(vec if isinstance(vec, list) else [])
            return out

        try:
            batch_vecs = _do_batch()
            # Record costs (approximate)
            try:
                ptoks = int(sum(len((t or "")) for t in batch_inputs) / 4)
                m = self.model
                in_rate = float(
                    cost_cfg.model_in_usd_per_1k.get(
                        m, cost_cfg.model_in_usd_per_1k.get("default", 0.0001)
                    )
                )
                usd = (ptoks / 1000.0) * in_rate
                cost_metrics.record_tokens(tenant_id, m, "embed", ptoks, 0, usd)
                rolling_cost.add(tenant_id, m, "embed", ptoks, 0, usd)
            except Exception:
                pass
            for idx, vec in zip(to_compute, batch_vecs):
                results[idx] = vec
                try:
                    redis_cache.set_tenant_key(tenant_id, keys[idx], vec, ttl=1800)
                except Exception:
                    pass
            circuit_breaker.record_success("openai_embed", tenant_id)
        except Exception as e:  # noqa: BLE001
            circuit_breaker.record_failure("openai_embed", tenant_id)
            # enqueue for async retry (best-effort)
            if hasattr(retries, "queue_enabled") and retries.queue_enabled:
                try:
                    retry_queue.enqueue(
                        job_type="embed_batch",
                        tenant_id=tenant_id,
                        payload={"count": len(batch_inputs), "model": self.model},
                        last_error=str(e),
                    )
                except Exception:
                    pass
        finally:
            try:
                throttle.release(tenant_id, kind="embed")
            except Exception as e:  # noqa: F841
                logging.getLogger(__name__).exception(
                    "[embedding.throttle_release] error", extra={"tenant_id": tenant_id}
                )
        # Normalize output length
        finalized: List[List[float]] = []
        for v in results:
            finalized.append(list(v or []))
        return finalized

    # Backwards-compatible alias expected by some callers
    def _embed_with_cache(self, texts: List[str], tenant_id: str) -> List[List[float]]:
        return self.embed_texts_with_cache(texts, tenant_id)
