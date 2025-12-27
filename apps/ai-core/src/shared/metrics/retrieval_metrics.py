from __future__ import annotations

try:
    from prometheus_client import Counter, Gauge  # type: ignore
except Exception:  # pragma: no cover
    Counter = None  # type: ignore
    Gauge = None  # type: ignore

from shared.config.tuning import telemetry


class RetrievalMetrics:
    def __init__(self) -> None:
        if telemetry.enable_metrics and Counter is not None:
            self.bm25_hits = Counter(
                "ai_core_bm25_cache_hits_total", "BM25 cache hits", ["tenant"]
            )
            self.bm25_miss = Counter(
                "ai_core_bm25_cache_miss_total", "BM25 cache misses", ["tenant"]
            )
        else:
            self.bm25_hits = None
            self.bm25_miss = None
        if telemetry.enable_metrics and Gauge is not None:
            self.duckdb_active = Gauge(
                "ai_core_duckdb_connections_active",
                "Active DuckDB connections",
                ["tenant"],
            )
        else:
            self.duckdb_active = None

    def inc_bm25_hit(self, tenant: str) -> None:
        try:
            if self.bm25_hits is not None:
                self.bm25_hits.labels(tenant=tenant).inc()
        except Exception:
            pass

    def inc_bm25_miss(self, tenant: str) -> None:
        try:
            if self.bm25_miss is not None:
                self.bm25_miss.labels(tenant=tenant).inc()
        except Exception:
            pass

    def set_duckdb_active(self, tenant: str, count: int) -> None:
        try:
            if self.duckdb_active is not None:
                self.duckdb_active.labels(tenant=tenant).set(float(max(0, int(count))))
        except Exception:
            pass


retrieval_metrics = RetrievalMetrics()
