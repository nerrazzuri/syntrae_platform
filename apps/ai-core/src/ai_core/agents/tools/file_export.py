from __future__ import annotations

from typing import Any, Dict, Optional
from .base import ToolSpec
from shared.config.tuning import agents as agent_cfg
from shared.metrics.agent_tool_metrics import agent_tool_metrics
from shared.throttling.agent_limits import allow_tool_call


class FileExportTool:
    spec = ToolSpec(
        tool_id="file.export.object_store",
        name="Object Store Export",
        version="1.0.0",
        description="Export content to tenant-scoped object storage path.",
        category="write",
        input_schema={
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "content": {"type": "string"},
                "content_type": {"type": "string"},
                "idempotency_key": {"type": "string"},
            },
            "required": ["path", "content", "content_type"],
        },
        output_schema={"type": "object"},
        required_scope="agent:tool:file.export",
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
        # Sandbox: simulate write and return object path
        path = payload.get("path") or ""
        if str(tenant_id) not in path:
            return {"status": "denied", "reason": "path_must_include_tenant"}
        size = len(payload.get("content") or "")
        if size > 1_000_000:
            return {"status": "denied", "reason": "size_limit"}
        return {"status": "ok", "object_path": path}


file_export_tool = FileExportTool()
