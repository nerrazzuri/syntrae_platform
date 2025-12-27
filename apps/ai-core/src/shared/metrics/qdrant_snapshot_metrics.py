from prometheus_client import Counter, Gauge


class _QdrantSnapshotMetrics:
    def __init__(self) -> None:
        self._success_total = Counter(
            "qdrant_snapshot_success_total", "Qdrant snapshot successes", ["collection"]
        )
        self._size_bytes = Gauge(
            "qdrant_snapshot_size_bytes", "Last snapshot size in bytes", ["collection"]
        )
        self._last_success_ts = Gauge(
            "qdrant_snapshot_last_success_unixtime",
            "Last snapshot success time (unix)",
            ["collection"],
        )

    def mark(self, collection: str, size_bytes: int, ts_unix: int) -> None:
        self._success_total.labels(collection=collection).inc()
        self._size_bytes.labels(collection=collection).set(max(0, int(size_bytes)))
        self._last_success_ts.labels(collection=collection).set(max(0, int(ts_unix)))


qdrant_snapshot_metrics = _QdrantSnapshotMetrics()


