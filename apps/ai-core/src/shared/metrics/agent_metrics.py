from __future__ import annotations

try:
    from prometheus_client import Counter, Histogram  # type: ignore
except Exception:  # pragma: no cover
    Counter = None  # type: ignore
    Histogram = None  # type: ignore

from shared.config.tuning import telemetry


class AgentMetrics:
    def __init__(self) -> None:
        if telemetry.enable_metrics and Counter is not None:
            self.actions_total = Counter(
                "ai_core_agent_actions_total",
                "Agent actions count",
                ["agent", "tenant", "action"],
            )
            self.failures_total = Counter(
                "ai_core_agent_failures_total", "Agent failures", ["agent", "tenant"]
            )
            self.denied_total = Counter(
                "ai_core_agent_denied_total",
                "Agent denied actions",
                ["agent", "tenant", "action"],
            )
            self.duration = Histogram(
                "ai_core_agent_duration_seconds", "Agent execution duration", ["agent"]
            )
            self.success_total = Counter(
                "ai_core_agent_success_total",
                "Agent successful runs",
                ["agent", "tenant"],
            )
        else:
            self.actions_total = None
            self.failures_total = None
            self.denied_total = None
            self.duration = None
            self.success_total = None

    def inc_action(self, agent: str, tenant: str, action: str) -> None:
        try:
            if self.actions_total:
                self.actions_total.labels(
                    agent=agent, tenant=tenant, action=action
                ).inc()
        except Exception:
            pass

    def inc_failure(self, agent: str, tenant: str) -> None:
        try:
            if self.failures_total:
                self.failures_total.labels(agent=agent, tenant=tenant).inc()
        except Exception:
            pass

    def inc_denied(self, agent: str, tenant: str, action: str) -> None:
        try:
            if self.denied_total:
                self.denied_total.labels(
                    agent=agent, tenant=tenant, action=action
                ).inc()
        except Exception:
            pass

    def inc_success(self, agent: str, tenant: str) -> None:
        try:
            if self.success_total:
                self.success_total.labels(agent=agent, tenant=tenant).inc()
        except Exception:
            pass

    def observe_duration(self, agent: str, seconds: float) -> None:
        try:
            if self.duration:
                self.duration.labels(agent=agent).observe(max(0.0, float(seconds)))
        except Exception:
            pass


agent_metrics = AgentMetrics()
