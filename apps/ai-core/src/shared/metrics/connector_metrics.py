from prometheus_client import Counter, Histogram


connector_sync_total = Counter(
    "connector_sync_total", "Connector sync runs", ["plan_type", "connector", "tenant_id", "status"]
)

connector_sync_failures_total = Counter(
    "connector_sync_failures_total", "Connector sync failures", ["tenant_id", "connector", "reason"]
)

connector_records_ingested_total = Counter(
    "connector_records_ingested_total", "Records ingested by connector", ["tenant_id", "connector"]
)

connector_bytes_processed_total = Counter(
    "connector_bytes_processed_total", "Bytes processed by connector", ["tenant_id", "connector"]
)

connector_duration_seconds = Histogram(
    "connector_duration_seconds", "Connector sync duration seconds", ["tenant_id", "connector"]
)

def inc_sync(plan_type: str, connector: str, tenant_id: str, status: str) -> None:
    try:
        connector_sync_total.labels(plan_type=plan_type or "unknown", connector=connector or "unknown", tenant_id=tenant_id or "unknown", status=status or "ok").inc()
    except Exception:
        pass

from shared.config.tuning import telemetry


class ConnectorMetrics:
    def __init__(self) -> None:
        if telemetry.enable_metrics and Counter is not None:
            self.sync_total = Counter(
                "ai_core_connector_sync_total",
                "Connector sync runs",
                ["connector", "tenant"],
            )
            self.fail_total = Counter(
                "ai_core_connector_failures_total",
                "Connector failures",
                ["connector", "tenant"],
            )
            self.records_total = Counter(
                "ai_core_connector_records_ingested_total",
                "Records ingested",
                ["connector", "tenant"],
            )
            self.duration = Histogram(
                "ai_core_connector_duration_seconds",
                "Connector sync duration",
                ["connector"],
            )
        else:
            self.sync_total = None
            self.fail_total = None
            self.records_total = None
            self.duration = None

    def inc_sync(self, name: str, tenant: str) -> None:
        try:
            if self.sync_total:
                self.sync_total.labels(connector=name, tenant=tenant).inc()
        except Exception:
            pass

    def inc_fail(self, name: str, tenant: str) -> None:
        try:
            if self.fail_total:
                self.fail_total.labels(connector=name, tenant=tenant).inc()
        except Exception:
            pass

    def inc_records(self, name: str, tenant: str, n: int) -> None:
        try:
            if self.records_total:
                self.records_total.labels(connector=name, tenant=tenant).inc(
                    max(0, int(n))
                )
        except Exception:
            pass

    def observe_duration(self, name: str, seconds: float) -> None:
        try:
            if self.duration:
                self.duration.labels(connector=name).observe(max(0.0, float(seconds)))
        except Exception:
            pass


connector_metrics = ConnectorMetrics()
