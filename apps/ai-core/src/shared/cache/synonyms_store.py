from typing import Dict
from shared.cache.redis import redis_cache


class SynonymsStore:
    """Per-tenant schema synonyms store backed by Redis.

    Stores alias -> canonical mappings to normalize field names across domains.
    """

    @staticmethod
    def _key(tenant_id: str) -> str:
        return f"schema:syn:{tenant_id}"

    @classmethod
    def get_all(cls, tenant_id: str) -> Dict[str, str]:
        data = redis_cache.get_tenant_key(tenant_id, cls._key(tenant_id))
        if isinstance(data, dict):
            # Ensure str->str
            out: Dict[str, str] = {}
            for k, v in data.items():
                try:
                    out[str(k)] = str(v)
                except Exception:
                    continue
            return out
        return {}

    @classmethod
    def put_many(cls, tenant_id: str, mappings: Dict[str, str]) -> None:
        if not mappings:
            return
        current = cls.get_all(tenant_id)
        current.update({str(k): str(v) for k, v in mappings.items()})
        # Keep a TTL to allow refresh; extend on every write
        redis_cache.set_tenant_key(
            tenant_id, cls._key(tenant_id), current, ttl=7 * 24 * 3600
        )
