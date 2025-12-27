from prometheus_client import Counter, Gauge


class _ComplianceMetrics:
    def __init__(self) -> None:
        self._last_run_ts = Gauge(
            "ai_core_compliance_last_run_timestamp",
            "Last compliance report run time (unix)",
        )
        self._failed_total = Counter(
            "ai_core_compliance_failed_reports_total",
            "Total failed compliance report generations",
        )
        self._noncompliant_tenants = Gauge(
            "ai_core_compliance_noncompliant_tenants_total",
            "Number of tenants currently non-compliant",
        )

    def mark_run(self, ts_unix: int) -> None:
        try:
            self._last_run_ts.set(max(0, int(ts_unix)))
        except Exception:
            pass

    def inc_failed(self) -> None:
        try:
            self._failed_total.inc()
        except Exception:
            pass

    def set_noncompliant(self, n: int) -> None:
        try:
            self._noncompliant_tenants.set(max(0, int(n)))
        except Exception:
            pass


compliance_metrics = _ComplianceMetrics()


