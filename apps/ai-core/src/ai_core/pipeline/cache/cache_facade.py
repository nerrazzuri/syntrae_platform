from typing import Optional, Any

from shared.cache.redis import redis_cache
import hashlib


class PipelineCache:
    """Thin cache facade to store retrieval/rerank artifacts per tenant+query hash."""

    def _key(self, tenant_id: str, scope: str, query: str) -> str:
        qh = hashlib.sha256((query or "").encode("utf-8")).hexdigest()
        return f"pipeline:{scope}:{tenant_id}:{qh}"

    def get(self, tenant_id: str, scope: str, query: str) -> Optional[Any]:
        try:
            return redis_cache.get_tenant_key(
                tenant_id, self._key(tenant_id, scope, query)
            )
        except Exception as e:
            import logging

            logger = logging.getLogger(__name__)
            logger.exception(
                "[pipeline_cache.get] error",
                extra={"tenant_id": tenant_id, "scope": scope},
            )
            return None

    def set(
        self, tenant_id: str, scope: str, query: str, value: Any, ttl: int = 600
    ) -> None:
        try:
            redis_cache.set_tenant_key(
                tenant_id, self._key(tenant_id, scope, query), value, ttl=ttl
            )
        except Exception as e:
            import logging

            logger = logging.getLogger(__name__)
            logger.exception(
                "[pipeline_cache.set] error",
                extra={"tenant_id": tenant_id, "scope": scope},
            )
