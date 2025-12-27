from __future__ import annotations

import logging

try:
    from prometheus_client import Counter, Histogram  # type: ignore
except Exception:  # pragma: no cover
    Counter = None  # type: ignore
    Histogram = None  # type: ignore

from shared.config.tuning import telemetry

logger = logging.getLogger(__name__)


class ReliabilityMetrics:
    def __init__(self) -> None:
        if telemetry.enable_metrics and Counter is not None:
            self.retries = Counter(
                "ai_core_retries_total", "Total retry attempts", ["operation"]
            )
            self.breaker_opens = Counter(
                "ai_core_circuit_opens_total",
                "Circuit breaker opened count",
                ["service"],
            )
            self.recovery_seconds = Histogram(
                "ai_core_recovery_seconds", "Recovery duration seconds", ["service"]
            )
        else:  # graceful no-op
            self.retries = None
            self.breaker_opens = None
            self.recovery_seconds = None

    def inc_retry(self, operation: str) -> None:
        try:
            if self.retries is not None:
                self.retries.labels(operation=operation).inc()
        except Exception:
            pass

    def inc_breaker_open(self, service: str) -> None:
        try:
            if self.breaker_opens is not None:
                self.breaker_opens.labels(service=service).inc()
        except Exception:
            pass

    def observe_recovery(self, service: str, seconds: float) -> None:
        try:
            if self.recovery_seconds is not None:
                self.recovery_seconds.labels(service=service).observe(max(0.0, seconds))
        except Exception:
            pass


reliability_metrics = ReliabilityMetrics()
