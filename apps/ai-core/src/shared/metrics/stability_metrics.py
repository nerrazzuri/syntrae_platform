from __future__ import annotations

try:
    from prometheus_client import Counter  # type: ignore
except Exception:  # pragma: no cover
    Counter = None  # type: ignore

from shared.config.tuning import telemetry


class StabilityMetrics:
    def __init__(self) -> None:
        if telemetry.enable_metrics and Counter is not None:
            self.bg_failures = Counter(
                "ai_core_background_failures_total",
                "Background loop failures",
                ["module"],
            )
            self.bg_retries = Counter(
                "ai_core_background_retries_total", "Background retries", ["module"]
            )
            self.errors_total = Counter(
                "ai_core_errors_total", "Errors logged", ["module", "tenant"]
            )
            self.exceptions_logged = Counter(
                "ai_core_exceptions_logged_total", "Exceptions logged", ["module"]
            )
        else:
            self.bg_failures = None
            self.bg_retries = None
            self.errors_total = None
            self.exceptions_logged = None

    def inc_bg_failure(self, module: str) -> None:
        try:
            if self.bg_failures:
                self.bg_failures.labels(module=module).inc()
        except Exception:
            pass

    def inc_bg_retry(self, module: str) -> None:
        try:
            if self.bg_retries:
                self.bg_retries.labels(module=module).inc()
        except Exception:
            pass

    def inc_error(self, module: str, tenant: str | None) -> None:
        try:
            if self.errors_total:
                self.errors_total.labels(
                    module=module, tenant=tenant or "unknown"
                ).inc()
        except Exception:
            pass

    def inc_exception(self, module: str) -> None:
        try:
            if self.exceptions_logged:
                self.exceptions_logged.labels(module=module).inc()
        except Exception:
            pass


stability_metrics = StabilityMetrics()
