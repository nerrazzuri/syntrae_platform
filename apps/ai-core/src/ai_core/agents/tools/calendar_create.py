from __future__ import annotations

from typing import Any, Dict, Optional
from .base import ToolSpec
from shared.config.tuning import agents as agent_cfg
from shared.metrics.agent_tool_metrics import agent_tool_metrics
from shared.throttling.agent_limits import allow_tool_call


class CalendarCreateTool:
    spec = ToolSpec(
        tool_id="calendar.event.create",
        name="Calendar Event Draft",
        version="1.0.0",
        description="Create a draft calendar event.",
        category="write",
        input_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "start": {"type": "string"},
                "end": {"type": "string"},
                "attendees": {"type": "array"},
                "location": {"type": "string"},
                "description": {"type": "string"},
            },
            "required": ["title", "start", "end"],
        },
        output_schema={"type": "object"},
        required_scope="agent:tool:calendar.create",
        sensitive=True,
        requires_preapproval=True,
        timeout_ms=agent_cfg.tool_default_timeout_ms,
        retries=agent_cfg.tool_retry_max,
        rate_limit_qps=agent_cfg.rate_limit_qps_per_tool,
    )

    def execute(
        self, *, tenant_id: str, api_key_id: Optional[str], payload: Dict[str, Any]
    ) -> Dict[str, Any]:
        tool = self.spec.tool_id
        agent_tool_metrics.inc_call(tenant_id, tool)
        if not allow_tool_call(tenant_id, tool, self.spec.rate_limit_qps):
            agent_tool_metrics.inc_rate_limit_hit(tenant_id, tool)
            return {"status": "rate_limited"}
        return {
            "status": "ok",
            "event_id": "event-" + (payload.get("title") or "")[0:8],
        }


calendar_create_tool = CalendarCreateTool()
