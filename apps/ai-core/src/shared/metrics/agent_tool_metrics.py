from prometheus_client import Counter


class _AgentToolMetrics:
    def __init__(self) -> None:
        self._calls_total = Counter(
            "agent_tool_calls_total", "Agent tool calls", ["tenant", "tool"]
        )
        self._fail_total = Counter(
            "agent_tool_failures_total", "Agent tool failures", ["tenant", "tool"]
        )
        self._timeouts_total = Counter(
            "agent_tool_timeouts_total", "Agent tool timeouts", ["tenant", "tool"]
        )
        self._policy_denials_total = Counter(
            "agent_policy_denials_total", "Policy denials", ["tenant", "tool"]
        )
        self._approvals_requested_total = Counter(
            "agent_approvals_requested_total", "Approvals requested", ["tenant", "tool"]
        )
        self._approvals_granted_total = Counter(
            "agent_approvals_granted_total", "Approvals granted", ["tenant", "tool"]
        )
        self._rate_limit_hits_total = Counter(
            "agent_rate_limit_hits_total", "Rate limit hits", ["tenant", "tool"]
        )

    def inc_call(self, tenant: str, tool: str) -> None:
        self._calls_total.labels(tenant=tenant, tool=tool).inc()

    def inc_fail(self, tenant: str, tool: str) -> None:
        self._fail_total.labels(tenant=tenant, tool=tool).inc()

    def inc_timeout(self, tenant: str, tool: str) -> None:
        self._timeouts_total.labels(tenant=tenant, tool=tool).inc()

    def inc_denial(self, tenant: str, tool: str) -> None:
        self._policy_denials_total.labels(tenant=tenant, tool=tool).inc()

    def inc_approval_requested(self, tenant: str, tool: str) -> None:
        self._approvals_requested_total.labels(tenant=tenant, tool=tool).inc()

    def inc_approval_granted(self, tenant: str, tool: str) -> None:
        self._approvals_granted_total.labels(tenant=tenant, tool=tool).inc()

    def inc_rate_limit_hit(self, tenant: str, tool: str) -> None:
        self._rate_limit_hits_total.labels(tenant=tenant, tool=tool).inc()


agent_tool_metrics = _AgentToolMetrics()
