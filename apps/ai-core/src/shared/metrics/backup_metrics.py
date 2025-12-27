from prometheus_client import Counter, Gauge, Histogram


class _BackupMetrics:
    def __init__(self) -> None:
        # system label: postgres|redis|qdrant|vault
        self._success_total = Counter(
            "backup_success_total", "Backup successes", ["system"]
        )
        self._failure_total = Counter(
            "backup_failure_total", "Backup failures", ["system"]
        )
        self._last_success_ts = Gauge(
            "backup_last_success_unixtime",
            "Last successful backup time (unix)",
            ["system"],
        )
        self._duration_ms = Histogram(
            "backup_duration_ms",
            "Backup duration (ms)",
            ["system"],
            buckets=(1000, 5000, 15000, 60000, 300000, 900000),
        )
        self._size_bytes = Gauge(
            "backup_last_size_bytes", "Last backup size in bytes", ["system"]
        )
        self._auth_fail_total = Counter("backup_auth_fail_total", "Unauthorized backup mark attempts")

    def mark(
        self,
        system: str,
        ok: bool,
        now_unix: int,
        duration_ms: int | None = None,
        size_bytes: int | None = None,
    ) -> None:
        if ok:
            self._success_total.labels(system=system).inc()
            self._last_success_ts.labels(system=system).set(max(0, int(now_unix)))
        else:
            self._failure_total.labels(system=system).inc()
        if duration_ms is not None:
            self._duration_ms.labels(system=system).observe(max(0, int(duration_ms)))
        if size_bytes is not None:
            self._size_bytes.labels(system=system).set(max(0, int(size_bytes)))

    def inc_auth_fail(self) -> None:
        self._auth_fail_total.inc()


backup_metrics = _BackupMetrics()
