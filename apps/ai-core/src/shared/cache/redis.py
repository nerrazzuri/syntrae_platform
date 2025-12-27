"""
Redis cache configuration and utilities with graceful degradation.

If Redis is unavailable, caching is transparently disabled to avoid
runtime failures or noisy logs. When disabled, all get/set operations
become no-ops and return sensible defaults.
"""
import json
from typing import Any, Optional, Union
from redis import Redis
from redis.cluster import RedisCluster
import logging
import os

logger = logging.getLogger(__name__)


class RedisCache:
    """Redis cache service with tenant isolation."""

    def __init__(self, url: Optional[str] = None):
        self.url = url or os.getenv("REDIS_URL", "redis://localhost:6379/0")
        self._client: Optional[Union[Redis, RedisCluster]] = None
        self._disabled: bool = False
        self._warned: bool = False

    def get_client(self) -> Union[Redis, RedisCluster]:
        """Get or create Redis client."""
        if self._client is None and not self._disabled:
            try:
                # Try cluster first
                self._client = RedisCluster.from_url(
                    self.url, socket_connect_timeout=0.5
                )
                logger.info("Connected to Redis Cluster")
            except Exception:
                try:
                    # Fall back to single instance
                    self._client = Redis.from_url(self.url, socket_connect_timeout=0.5)
                    logger.info("Connected to Redis single instance")
                except Exception as e:
                    # Disable caching gracefully
                    self._client = None
                    self._disabled = True
                    if not self._warned:
                        logger.warning(
                            f"Redis unavailable at {self.url}. Caching disabled. ({e})"
                        )
                        self._warned = True

        return self._client  # May be None when disabled

    def set_tenant_key(
        self, tenant_id: str, key: str, value: Any, ttl: int = 3600
    ) -> bool:
        """Set a tenant-specific cache key."""
        if self._disabled or self.get_client() is None:
            return False
        try:
            tenant_key = f"tenant:{tenant_id}:{key}"
            serialized_value = (
                json.dumps(value) if isinstance(value, (dict, list)) else str(value)
            )
            return self.get_client().setex(tenant_key, ttl, serialized_value)
        except Exception as e:
            if not self._warned:
                logger.warning(
                    f"Failed to set cache key {key} for tenant {tenant_id}: {e}"
                )
                self._warned = True
            return False

    def get_tenant_key(self, tenant_id: str, key: str) -> Optional[Any]:
        """Get a tenant-specific cache key."""
        if self._disabled or self.get_client() is None:
            return None
        try:
            tenant_key = f"tenant:{tenant_id}:{key}"
            value = self.get_client().get(tenant_key)
            if value is None:
                return None

            # Try to parse as JSON, fall back to string
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                return value.decode("utf-8") if isinstance(value, bytes) else value
        except Exception as e:
            if not self._warned:
                logger.warning(
                    f"Failed to get cache key {key} for tenant {tenant_id}: {e}"
                )
                self._warned = True
            return None

    def delete_tenant_key(self, tenant_id: str, key: str) -> bool:
        """Delete a tenant-specific cache key."""
        if self._disabled or self.get_client() is None:
            return False
        try:
            tenant_key = f"tenant:{tenant_id}:{key}"
            return bool(self.get_client().delete(tenant_key))
        except Exception as e:
            if not self._warned:
                logger.warning(
                    f"Failed to delete cache key {key} for tenant {tenant_id}: {e}"
                )
                self._warned = True
            return False

    def clear_tenant_cache(self, tenant_id: str) -> bool:
        """Clear all cache keys for a specific tenant."""
        if self._disabled or self.get_client() is None:
            return True
        try:
            client = self.get_client()
            pattern = f"tenant:{tenant_id}:*"
            keys = client.keys(pattern)

            if keys:
                return bool(client.delete(*keys))

            return True
        except Exception as e:
            if not self._warned:
                logger.warning(f"Failed to clear cache for tenant {tenant_id}: {e}")
                self._warned = True
            return False

    def set_session(self, session_id: str, data: dict, ttl: int = 1800) -> bool:
        """Set session data."""
        if self._disabled or self.get_client() is None:
            return False
        try:
            session_key = f"session:{session_id}"
            return self.get_client().setex(session_key, ttl, json.dumps(data))
        except Exception as e:
            if not self._warned:
                logger.warning(f"Failed to set session {session_id}: {e}")
                self._warned = True
            return False

    def get_session(self, session_id: str) -> Optional[dict]:
        """Get session data."""
        if self._disabled or self.get_client() is None:
            return None
        try:
            session_key = f"session:{session_id}"
            data = self.get_client().get(session_key)
            return json.loads(data) if data else None
        except Exception as e:
            if not self._warned:
                logger.warning(f"Failed to get session {session_id}: {e}")
                self._warned = True
            return None

    def delete_session(self, session_id: str) -> bool:
        """Delete session data."""
        if self._disabled or self.get_client() is None:
            return False
        try:
            session_key = f"session:{session_id}"
            return bool(self.get_client().delete(session_key))
        except Exception as e:
            if not self._warned:
                logger.warning(f"Failed to delete session {session_id}: {e}")
                self._warned = True
            return False

    def ping(self) -> bool:
        """Test Redis connection."""
        if self._disabled or self.get_client() is None:
            return False
        try:
            return bool(self.get_client().ping())
        except Exception:
            return False


# Global cache instance
redis_cache = RedisCache()
