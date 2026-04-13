import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone

import redis.asyncio as redis
from redis.exceptions import WatchError

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class QuotaReservation:
    key: str
    amount: int


class RedisQuotaStore:
    def __init__(
        self,
        redis_url: str | None = None,
        *,
        key_prefix: str = "rl:automation",
        ttl_seconds: int = 2 * 60 * 60,
        max_retries: int = 3,
    ):
        self.redis_url = redis_url or os.getenv("REDIS_URL", "redis://redis:6379/0")
        self.key_prefix = key_prefix
        self.ttl_seconds = ttl_seconds
        self.max_retries = max_retries
        self._client: redis.Redis | None = None

    @property
    def client(self) -> redis.Redis:
        if self._client is None:
            self._client = redis.from_url(
                self.redis_url,
                decode_responses=True,
                socket_connect_timeout=2,
                socket_timeout=2,
            )
        return self._client

    def quota_key(self, brand_id: str, platform: str, metric: str) -> str:
        bucket = datetime.now(timezone.utc).strftime("%Y%m%d%H")
        safe_brand_id = (brand_id or "unknown-brand").strip()
        safe_platform = (platform or "unknown-platform").strip().lower()
        return f"{self.key_prefix}:{safe_brand_id}:{safe_platform}:{metric}:{bucket}"

    async def reserve(self, key: str, requested: int, limit: int) -> int:
        if requested <= 0 or limit <= 0:
            return 0

        for attempt in range(1, self.max_retries + 1):
            async with self.client.pipeline() as pipe:
                try:
                    await pipe.watch(key)
                    current_raw = await pipe.get(key)
                    current = int(current_raw or 0)
                    remaining = max(0, limit - current)
                    amount = min(requested, remaining)
                    if amount <= 0:
                        await pipe.unwatch()
                        return 0

                    pipe.multi()
                    pipe.incrby(key, amount)
                    pipe.expire(key, self.ttl_seconds)
                    await pipe.execute()
                    return amount
                except WatchError:
                    if attempt == self.max_retries:
                        raise
                    continue

        return 0

    async def release(self, reservation: QuotaReservation | None, unused: int) -> int:
        if not reservation or unused <= 0:
            return 0

        amount = min(unused, reservation.amount)
        for attempt in range(1, self.max_retries + 1):
            async with self.client.pipeline() as pipe:
                try:
                    await pipe.watch(reservation.key)
                    current_raw = await pipe.get(reservation.key)
                    current = int(current_raw or 0)
                    new_value = max(0, current - amount)

                    pipe.multi()
                    if new_value == 0:
                        pipe.delete(reservation.key)
                    else:
                        pipe.set(reservation.key, new_value, ex=self.ttl_seconds)
                    await pipe.execute()
                    return amount
                except WatchError:
                    if attempt == self.max_retries:
                        raise
                    continue

        return 0
