from __future__ import annotations

from prometheus_client import Counter


class IngestionMetrics:
    def __init__(self) -> None:
        self._success = Counter(
            "ai_core_ingestion_success_total",
            "Successful ingestions",
            ["tenant_id"],
        )
        self._failure = Counter(
            "ai_core_ingestion_failure_total",
            "Failed ingestions",
            ["tenant_id"],
        )

    def inc_success(self, tenant_id: str, count: int = 1) -> None:
        try:
            self._success.labels(tenant_id=str(tenant_id)).inc(count)
        except Exception:
            pass

    def inc_failure(self, tenant_id: str, count: int = 1) -> None:
        try:
            self._failure.labels(tenant_id=str(tenant_id)).inc(count)
        except Exception:
            pass


ingestion_metrics = IngestionMetrics()


