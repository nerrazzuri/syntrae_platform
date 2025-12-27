from prometheus_client import Counter, Gauge, Histogram


class _ApprovalMetrics:
    def __init__(self) -> None:
        self._exec_total = Counter(
            "agent_approval_exec_total", "Approval executions", ["status"]
        )  # success|failure
        self._queue_size = Gauge(
            "agent_approval_queue_size", "Approved but not executed approvals"
        )
        self._latency = Histogram(
            "agent_approval_exec_latency_ms",
            "Approval execution latency (ms)",
            buckets=(50, 100, 200, 500, 1000, 2000, 5000),
        )

    def inc_success(self) -> None:
        self._exec_total.labels(status="success").inc()

    def inc_failure(self) -> None:
        self._exec_total.labels(status="failure").inc()

    def set_queue(self, size: int) -> None:
        self._queue_size.set(max(0, int(size)))

    def observe_latency_ms(self, ms: int) -> None:
        self._latency.observe(max(0, int(ms)))


approval_metrics = _ApprovalMetrics()
