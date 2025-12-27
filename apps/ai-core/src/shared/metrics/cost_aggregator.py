from __future__ import annotations

from typing import Dict, Tuple
import threading
import time



class RollingCostAggregator:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        # (tenant, model, kind) -> (tokens_in, tokens_out, usd, last_ts)
        self._buckets: Dict[Tuple[str, str, str], Tuple[int, int, float, float]] = {}

    def add(
        self, tenant: str, model: str, kind: str, tin: int, tout: int, usd: float
    ) -> None:
        now = time.time()
        k = (tenant, model, kind)
        with self._lock:
            prev = self._buckets.get(k, (0, 0, 0.0, now))
            self._buckets[k] = (prev[0] + tin, prev[1] + tout, prev[2] + usd, now)

    def snapshot_and_clear(self) -> Dict[Tuple[str, str, str], Tuple[int, int, float]]:
        with self._lock:
            out: Dict[Tuple[str, str, str], Tuple[int, int, float]] = {}
            for k, v in self._buckets.items():
                out[k] = (v[0], v[1], v[2])
            self._buckets.clear()
            return out


rolling_cost = RollingCostAggregator()
