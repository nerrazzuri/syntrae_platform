from prometheus_client import Counter, REGISTRY


def _get_or_reuse_counter(name: str, documentation: str) -> Counter:
    try:
        return Counter(name, documentation)
    except ValueError as e:
        # Handle duplicate registration on hot reloads or multiple imports
        if "Duplicated timeseries" in str(e):
            try:
                # Reuse existing collector from the default registry
                existing = getattr(REGISTRY, "_names_to_collectors", {}).get(name)  # type: ignore[attr-defined]
                if isinstance(existing, Counter):
                    return existing  # type: ignore[return-value]
            except Exception:
                pass
        raise


class _ExceptionMetrics:
    def __init__(self) -> None:
        self._exceptions_total = _get_or_reuse_counter(
            "ai_core_exceptions_logged_total", "Total exceptions captured in AI-Core"
        )

    def inc(self) -> None:
        self._exceptions_total.inc()


exception_metrics = _ExceptionMetrics()
