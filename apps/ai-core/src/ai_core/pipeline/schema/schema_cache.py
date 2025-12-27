from typing import Dict, List


class SchemaCache:
    """In-memory cache facade for schema fields per tenant (placeholder)."""

    def __init__(self):
        self._cache: Dict[str, List[str]] = {}

    def get(self, tenant_id: str) -> List[str]:
        return self._cache.get(tenant_id, [])

    def set(self, tenant_id: str, fields: List[str]) -> None:
        self._cache[tenant_id] = list(fields)
