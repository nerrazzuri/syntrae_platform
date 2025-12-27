"""
Cross-channel session management backed by Redis.
"""
import uuid
from typing import Optional, Dict, Any
from shared.cache.redis import redis_cache


class SessionService:
    def __init__(self):
        self.cache = redis_cache

    def get_or_create_session(self, tenant_id: str, user_id: str) -> str:
        key = f"conv:{tenant_id}:{user_id}"
        sess = self.cache.get_tenant_key(tenant_id, key)
        if sess:
            return sess
        session_id = str(uuid.uuid4())
        self.cache.set_tenant_key(tenant_id, key, session_id, ttl=86400)
        return session_id

    def set_channel_mapping(
        self, tenant_id: str, session_id: str, channel: str, identifier: str
    ) -> bool:
        key = f"convmap:{session_id}"
        data = self.cache.get_tenant_key(tenant_id, key) or {}
        data[channel] = identifier
        return bool(self.cache.set_tenant_key(tenant_id, key, data, ttl=86400))

    def get_channel_mapping(
        self, tenant_id: str, session_id: str
    ) -> Optional[Dict[str, Any]]:
        key = f"convmap:{session_id}"
        return self.cache.get_tenant_key(tenant_id, key)
