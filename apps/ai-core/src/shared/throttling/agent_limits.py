from __future__ import annotations

import time
from shared.cache.redis import redis_cache


def allow_tool_call(tenant_id: str, tool_id: str, qps: int) -> bool:
    """Token bucket per tenant+tool with 1-second window in Redis."""
    try:
        key = f"agt:rl:{tenant_id}:{tool_id}:{int(time.time())}"
        cur = redis_cache.incr(key)
        if cur == 1:
            redis_cache.expire(key, 2)
        return int(cur) <= max(1, int(qps))
    except Exception:
        # fail open if redis not available
        return True
