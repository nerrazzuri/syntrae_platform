from __future__ import annotations

from typing import Any, Dict, Optional
from .base import ToolSpec
from shared.config.tuning import agents as agent_cfg
from shared.metrics.agent_tool_metrics import agent_tool_metrics
from shared.throttling.agent_limits import allow_tool_call


class EmailDraftTool:
    spec = ToolSpec(
        tool_id="email.draft.create",
        name="Email Draft Create",
        version="1.0.0",
        description="Create an email draft (never send).",
        category="write",
        input_schema={
            "type": "object",
            "properties": {
                "to": {"type": "array"},
                "cc": {"type": "array"},
                "subject": {"type": "string"},
                "body_markdown": {"type": "string"},
            },
            "required": ["to", "subject", "body_markdown"],
        },
        output_schema={"type": "object"},
        required_scope="agent:tool:email.draft",
        sensitive=True,
        requires_preapproval=False,
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
            "draft_id": "draft-" + (payload.get("subject") or "")[0:8],
        }


email_draft_tool = EmailDraftTool()
