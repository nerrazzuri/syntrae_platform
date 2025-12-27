from prometheus_client import Counter, Gauge


class _RestoreMetrics:
    def __init__(self) -> None:
        self._success_total = Counter("restore_drill_success_total", "Restore drill successes")
        self._duration_seconds = Gauge("restore_drill_duration_seconds", "Last restore drill duration (s)")
        self._rto_compliance = Gauge("restore_rto_compliance", "RTO compliance flag (1 compliant, 0 not)")
        self._rpo_compliance = Gauge("restore_rpo_compliance", "RPO compliance flag (1 compliant, 0 not)")

    def mark(self, ok: bool, duration_s: int, rto_ok: bool, rpo_ok: bool) -> None:
        if ok:
            self._success_total.inc()
        self._duration_seconds.set(max(0, int(duration_s)))
        self._rto_compliance.set(1 if rto_ok else 0)
        self._rpo_compliance.set(1 if rpo_ok else 0)


restore_metrics = _RestoreMetrics()


