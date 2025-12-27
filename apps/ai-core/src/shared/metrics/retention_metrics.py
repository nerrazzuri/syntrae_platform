from prometheus_client import Counter, Gauge


class _RetentionMetrics:
    def __init__(self) -> None:
        self._deleted_total = Counter(
            "ai_core_retention_deleted_total",
            "Records deleted by retention",
            ["tenant", "data_type"],
        )
        self._archived_total = Counter(
            "ai_core_retention_archived_total",
            "Records archived by retention",
            ["tenant", "data_type"],
        )
        self._errors_total = Counter(
            "ai_core_retention_errors_total",
            "Retention errors",
            ["module"],
        )
        self._lag_seconds = Gauge(
            "ai_core_retention_lag_seconds",
            "Seconds since last retention enforcement",
        )

    def inc_deleted(self, tenant: str, data_type: str, n: int) -> None:
        for _ in range(max(0, int(n))):
            self._deleted_total.labels(tenant=tenant, data_type=data_type).inc()

    def inc_archived(self, tenant: str, data_type: str, n: int) -> None:
        for _ in range(max(0, int(n))):
            self._archived_total.labels(tenant=tenant, data_type=data_type).inc()

    def inc_error(self, module: str) -> None:
        self._errors_total.labels(module=module).inc()

    def set_lag(self, seconds: int) -> None:
        self._lag_seconds.set(max(0, int(seconds)))


retention_metrics = _RetentionMetrics()


