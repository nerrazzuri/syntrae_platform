from __future__ import annotations

from typing import Any, Dict, Optional, List
from .base import ToolSpec
from shared.config.tuning import agents as agent_cfg
from shared.metrics.agent_tool_metrics import agent_tool_metrics
from shared.throttling.agent_limits import allow_tool_call


def _normalize(items: List[Dict[str, Any]], source: str) -> Dict[str, Any]:
    results = []
    for it in items:
        results.append(
            {
                "id": it.get("id") or it.get("doc_id") or it.get("url"),
                "title": it.get("title") or it.get("name") or "",
                "snippet": it.get("snippet") or it.get("summary") or "",
                "url": it.get("url") or it.get("web_url") or "",
                "source_system": source,
            }
        )
    return {"status": "ok", "results": results}


class SharePointSearch:
    spec = ToolSpec(
        tool_id="sharepoint.search",
        name="SharePoint Search",
        version="1.0.0",
        description="Search SharePoint",
        category="read",
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "scope": {"type": "string"},
                "limit": {"type": "integer"},
            },
            "required": ["query"],
        },
        output_schema={"type": "object"},
        required_scope="agent:tool:search.read",
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
        # Placeholder: return empty result set
        return _normalize([], "sharepoint")


class GoogleDriveSearch:
    spec = ToolSpec(
        tool_id="googledrive.search",
        name="Google Drive Search",
        version="1.0.0",
        description="Search Google Drive",
        category="read",
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "scope": {"type": "string"},
                "limit": {"type": "integer"},
            },
            "required": ["query"],
        },
        output_schema={"type": "object"},
        required_scope="agent:tool:search.read",
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
        return _normalize([], "googledrive")


class SalesforceSearch:
    spec = ToolSpec(
        tool_id="salesforce.search",
        name="Salesforce Search",
        version="1.0.0",
        description="Search Salesforce",
        category="read",
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "scope": {"type": "string"},
                "limit": {"type": "integer"},
            },
            "required": ["query"],
        },
        output_schema={"type": "object"},
        required_scope="agent:tool:search.read",
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
        return _normalize([], "salesforce")


sharepoint_search = SharePointSearch()
googledrive_search = GoogleDriveSearch()
salesforce_search = SalesforceSearch()
