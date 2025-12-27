from __future__ import annotations

from typing import Any, Dict, Optional
from .base import ToolSpec
from shared.config.tuning import agents as agent_cfg
from shared.metrics.agent_tool_metrics import agent_tool_metrics
from shared.throttling.agent_limits import allow_tool_call
from sqlalchemy import text as _sql
from shared.database.session import SessionLocal


class SQLReadTool:
    spec = ToolSpec(
        tool_id="sql.query.read",
        name="SQL Read Query",
        version="1.0.0",
        description="Execute read-only named or parameterized queries against allowlisted connections.",
        category="read",
        input_schema={
            "type": "object",
            "properties": {
                "connection_id": {"type": "string"},
                "named_query": {"type": "string"},
                "query": {"type": "string"},
                "params": {"type": "object"},
                "limit": {"type": "integer"},
            },
            "required": ["connection_id"],
        },
        output_schema={"type": "object"},
        required_scope="agent:tool:sql.read",
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
        # Simplified: single shared DB connection (Postgres) via SessionLocal
        # Enforce LIMIT
        limit = int(payload.get("limit") or 50)
        limit = min(max(1, limit), 200)
        q = payload.get("named_query") or payload.get("query")
        if not q:
            return {"status": "error", "error": "missing query"}
        if any(
            x in q.lower()
            for x in ("update ", "delete ", "insert ", "drop ", "alter ", "create ")
        ):
            return {"status": "denied", "reason": "write_statement_blocked"}
        sql = f"{q} LIMIT {limit}"
        s = SessionLocal()
        try:
            rows = s.execute(_sql(sql), payload.get("params") or {}).fetchmany(limit)
            cols = list(rows[0].keys()) if rows else []
            data = [dict(r) for r in rows]
            return {"status": "ok", "columns": cols, "rows": data}
        finally:
            try:
                s.close()
            except Exception:
                pass


sql_read_tool = SQLReadTool()
