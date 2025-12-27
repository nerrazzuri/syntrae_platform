from __future__ import annotations

import threading
import time
from typing import Dict, Tuple, Optional

from shared.config.tuning import circuit_breaker as cb_cfg


class CircuitBreaker:
    """Simple in-memory circuit breaker with tenant-aware keys.

    States: closed -> open -> half-open (probe) -> closed
    """

    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"

    def __init__(self) -> None:
        self._lock = threading.Lock()
        # key -> (state, failures, opened_at_ms)
        self._state: Dict[str, Tuple[str, int, int]] = {}

    def _now_ms(self) -> int:
        return int(time.time() * 1000)

    def _key(self, service: str, tenant_id: Optional[str]) -> str:
        return (
            f"{service}:{tenant_id}" if (cb_cfg.tenant_aware and tenant_id) else service
        )

    def allow(self, service: str, tenant_id: Optional[str]) -> bool:
        k = self._key(service, tenant_id)
        with self._lock:
            st, failures, opened = self._state.get(k, (self.CLOSED, 0, 0))
            if st == self.CLOSED:
                return True
            if st == self.OPEN:
                # Check cooldown
                if self._now_ms() - opened >= cb_cfg.cooldown_ms:
                    # transition to half-open
                    self._state[k] = (self.HALF_OPEN, 0, opened)
                    return True  # allow limited probe
                return False
            if st == self.HALF_OPEN:
                # allow only half_open_probe simultaneous probes by counting failures negative
                return True
            return True

    def record_success(self, service: str, tenant_id: Optional[str]) -> None:
        k = self._key(service, tenant_id)
        with self._lock:
            self._state[k] = (self.CLOSED, 0, 0)

    def record_failure(self, service: str, tenant_id: Optional[str]) -> None:
        k = self._key(service, tenant_id)
        with self._lock:
            st, failures, opened = self._state.get(k, (self.CLOSED, 0, 0))
            failures += 1
            if (
                st in (self.CLOSED, self.HALF_OPEN)
                and failures >= cb_cfg.failure_threshold
            ):
                self._state[k] = (self.OPEN, failures, self._now_ms())
            else:
                self._state[k] = (st, failures, opened)

    def state(self, service: str, tenant_id: Optional[str]) -> str:
        k = self._key(service, tenant_id)
        with self._lock:
            st, _, _ = self._state.get(k, (self.CLOSED, 0, 0))
            return st


circuit_breaker = CircuitBreaker()
