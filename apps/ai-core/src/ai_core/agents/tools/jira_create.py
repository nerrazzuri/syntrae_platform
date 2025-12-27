from __future__ import annotations

from typing import Any, Dict, Optional
from .base import ToolSpec
from shared.config.tuning import agents as agent_cfg
from shared.metrics.agent_tool_metrics import agent_tool_metrics
from shared.throttling.agent_limits import allow_tool_call
import uuid


class JiraCreateTool:
    spec = ToolSpec(
        tool_id="jira.create",
        name="Jira Ticket Create",
        version="1.0.0",
        description="Create a Jira issue (pre-approval default).",
        category="write",
        input_schema={
            "type": "object",
            "properties": {
                "project": {"type": "string"},
                "summary": {"type": "string"},
                "description": {"type": "string"},
                "assignee": {"type": "string"},
                "priority": {"type": "string"},
                "idempotency_key": {"type": "string"},
            },
            "required": ["project", "summary"],
        },
        output_schema={"type": "object"},
        required_scope="agent:tool:jira.create",
        sensitive=True,
        requires_preapproval=True,
        timeout_ms=agent_cfg.tool_default_timeout_ms,
        retries=agent_cfg.tool_retry_max,
        rate_limit_qps=agent_cfg.rate_limit_qps_per_tool,
        idempotency_required=True,
    )

    def execute(
        self, *, tenant_id: str, api_key_id: Optional[str], payload: Dict[str, Any]
    ) -> Dict[str, Any]:
        tool = self.spec.tool_id
        agent_tool_metrics.inc_call(tenant_id, tool)
        if not allow_tool_call(tenant_id, tool, self.spec.rate_limit_qps):
            agent_tool_metrics.inc_rate_limit_hit(tenant_id, tool)
            return {"status": "rate_limited"}
        # Sandbox: do not call external; simulate draft creation and return id
        issue_key = f"{str(uuid.uuid4())[:8].upper()}"
        return {
            "status": "ok",
            "issue_key": issue_key,
            "summary": payload.get("summary"),
        }


jira_create_tool = JiraCreateTool()
