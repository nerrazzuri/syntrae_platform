from __future__ import annotations

import json
import time
from typing import Any, Dict, Optional

from shared.cache.redis import redis_cache
from shared.config.tuning import retries


class RetryQueue:
    """Lightweight retry queue backed by Redis lists.

    Jobs are JSON objects with keys: type, tenant_id, payload, last_error, last_retry_ts
    """

    def __init__(self) -> None:
        self.ns = retries.queue_namespace

    def _key(self, job_type: str) -> str:
        return f"{self.ns}:{job_type}"

    def enqueue(
        self,
        job_type: str,
        tenant_id: str,
        payload: Dict[str, Any],
        last_error: Optional[str] = None,
    ) -> None:
        cli = redis_cache.get_client()
        if not cli:
            return
        data = {
            "type": job_type,
            "tenant_id": tenant_id,
            "payload": payload,
            "last_error": last_error,
            "last_retry_ts": int(time.time()),
        }
        cli.rpush(self._key(job_type), json.dumps(data))

    def dequeue(self, job_type: str, timeout: int = 1) -> Optional[Dict[str, Any]]:
        cli = redis_cache.get_client()
        if not cli:
            return None
        res = cli.blpop(self._key(job_type), timeout=timeout)
        if not res:
            return None
        _k, raw = res
        try:
            return json.loads(raw)
        except Exception:
            return None


retry_queue = RetryQueue()
