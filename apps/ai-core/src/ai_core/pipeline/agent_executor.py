from __future__ import annotations

from typing import Dict, Any, List
import time

from shared.config.tuning import agents as agent_cfg
from shared.metrics.agent_metrics import agent_metrics
from shared.metrics.agent_tool_metrics import agent_tool_metrics
from ai_core.pipeline.audit_service import write_audit
from ai_core.agents.tools import tool_registry  # registers tools at import
from ai_core.agents.policy import PolicyEngine
from shared.security.pii import redact
import logging


class AgentExecutor:
    def __init__(self, agent_cls) -> None:
        self.agent = agent_cls()

    def run(
        self, goal: str, tenant_id: str, claims: Dict[str, Any], db
    ) -> Dict[str, Any]:
        if not agent_cfg.enabled:
            return {"ok": False, "error": "agents_disabled"}
        t0 = time.time()
        name = getattr(self.agent, "name", "agent")
        plan: List[Dict[str, Any]] = []
        try:
            plan = self.agent.plan(goal, {"tenant_id": tenant_id})[
                : agent_cfg.max_steps
            ]
        except Exception as e:
            agent_metrics.inc_failure(name, tenant_id)
            logging.getLogger(__name__).exception(
                "[agent.plan] error",
                extra={"tenant_id": tenant_id, "action": "agent.exec", "agent": name},
            )
            return {"ok": False, "error": str(e)}
        steps_out: List[Dict[str, Any]] = []
        pol = PolicyEngine(db)
        for step in plan:
            action = str(step.get("action", "")).strip()
            params = step.get("params", {}) or {}
            if not action:
                continue
            tool = tool_registry.get(action)
            if not tool:
                agent_metrics.inc_denied(name, tenant_id, action)
                steps_out.append({"tool_id": action, "status": "unknown_tool"})
                continue
            # Policy pre-check per tool spec
            decision = pol.decide(
                tenant_id=tenant_id,
                api_key_id=claims.get("api_key_id"),
                tool_id=tool.spec.tool_id,
                category=tool.spec.category,
                payload=params,
                sensitive=tool.spec.sensitive,
                require_scope=tool.spec.required_scope,
                preapproval_default=tool.spec.requires_preapproval,
            )
            if decision.requires_approval:
                steps_out.append(
                    {
                        "tool_id": tool.spec.tool_id,
                        "status": "pending_approval",
                        "approval_id": decision.approval_id,
                    }
                )
                try:
                    write_audit(
                        db,
                        tenant_id,
                        claims.get("user_id"),
                        "agent.tool.approval.request",
                        tool.spec.tool_id,
                        redact(str(params)),
                        "",
                        True,
                        int((time.time() - t0) * 1000),
                        category="agent",
                        auth_type=claims.get("auth_type"),
                    )
                except Exception:
                    pass
                continue
            if not decision.allowed:
                agent_tool_metrics.inc_denial(tenant_id, tool.spec.tool_id)
                steps_out.append(
                    {
                        "tool_id": tool.spec.tool_id,
                        "status": "denied",
                        "reason": decision.reason,
                    }
                )
                try:
                    write_audit(
                        db,
                        tenant_id,
                        claims.get("user_id"),
                        "agent.tool.deny",
                        tool.spec.tool_id,
                        redact(str(params)),
                        decision.reason or "",
                        False,
                        int((time.time() - t0) * 1000),
                        category="agent",
                        auth_type=claims.get("auth_type"),
                    )
                except Exception:
                    pass
                continue
            # Execute tool
            try:
                agent_metrics.inc_action(name, tenant_id, action)
                res = tool.execute(
                    tenant_id=tenant_id,
                    api_key_id=claims.get("api_key_id"),
                    payload=params,
                )
                steps_out.append(
                    {
                        "tool_id": tool.spec.tool_id,
                        "status": res.get("status"),
                        "output_summary": {
                            k: v for k, v in res.items() if k != "status"
                        },
                    }
                )
                try:
                    write_audit(
                        db,
                        tenant_id,
                        claims.get("user_id"),
                        "agent.tool.call",
                        tool.spec.tool_id,
                        redact(str(params)),
                        redact(str(res))[:500],
                        True,
                        int((time.time() - t0) * 1000),
                        category="agent",
                        auth_type=claims.get("auth_type"),
                    )
                except Exception:
                    pass
            except Exception as e:
                agent_metrics.inc_failure(name, tenant_id)
                logging.getLogger(__name__).exception(
                    "[agent.execute] error",
                    extra={"tenant_id": tenant_id, "action": action, "agent": name},
                )
                steps_out.append(
                    {"tool_id": tool.spec.tool_id, "status": "error", "error": str(e)}
                )
        dur = time.time() - t0
        agent_metrics.observe_duration(name, dur)
        if any(s.get("status") == "ok" for s in steps_out):
            agent_metrics.inc_success(name, tenant_id)
        return {
            "ok": True,
            "agent": name,
            "steps": steps_out,
            "elapsed_ms": int(dur * 1000),
        }
