from __future__ import annotations

import hashlib
from typing import Optional, Dict, Any

from shared.cache.redis import redis_cache


class GenerationCache:
    def _key(self, tenant_id: str, model: str, prompt: str) -> str:
        h = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
        return f"gen:{tenant_id}:{model}:{h}"

    def get(self, tenant_id: str, model: str, prompt: str) -> Optional[Dict[str, Any]]:
        return redis_cache.get_tenant_key(
            tenant_id, self._key(tenant_id, model, prompt)
        )

    def set(
        self,
        tenant_id: str,
        model: str,
        prompt: str,
        value: Dict[str, Any],
        ttl: int = 900,
    ) -> None:
        redis_cache.set_tenant_key(
            tenant_id, self._key(tenant_id, model, prompt), value, ttl
        )


generation_cache = GenerationCache()
