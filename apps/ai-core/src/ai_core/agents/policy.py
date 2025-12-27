from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Any, Optional
from sqlalchemy.orm import Session
from shared.database.models import ApiKey, Approval
from shared.metrics.agent_tool_metrics import agent_tool_metrics
from shared.security.pii import redact
import hashlib
import uuid


def _h(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


@dataclass
class PolicyDecision:
    allowed: bool
    requires_approval: bool = False
    approval_id: Optional[str] = None
    reason: Optional[str] = None


class PolicyEngine:
    def __init__(self, db: Session) -> None:
        self.db = db

    def _has_scope(
        self, tenant_id: str, api_key_id: Optional[str], required_scope: str
    ) -> bool:
        if not api_key_id:
            return False
        try:
            rec = self.db.get(ApiKey, uuid.UUID(str(api_key_id)))
            if not rec or str(rec.tenant_id) != str(tenant_id):
                return False
            scopes = rec.scopes or []
            if required_scope in scopes or "agent:*" in scopes:
                return True
        except Exception:
            return False
        return False

    def decide(
        self,
        *,
        tenant_id: str,
        api_key_id: Optional[str],
        tool_id: str,
        category: str,
        payload: Dict[str, Any],
        sensitive: bool,
        require_scope: str,
        preapproval_default: bool,
    ) -> PolicyDecision:
        # Scope check
        if not self._has_scope(tenant_id, api_key_id, require_scope):
            agent_tool_metrics.inc_denial(tenant_id, tool_id)
            return PolicyDecision(allowed=False, reason="missing_scope")
        # ABAC examples (simplified placeholder)
        # business_hours_only, environment!=prod unless admin, etc. For now, allow.
        # Approvals
        if category in ("write", "admin") and (preapproval_default or sensitive):
            aid = self._create_approval(tenant_id, tool_id, payload)
            agent_tool_metrics.inc_approval_requested(tenant_id, tool_id)
            return PolicyDecision(
                allowed=False,
                requires_approval=True,
                approval_id=aid,
                reason="pending_approval",
            )
        return PolicyDecision(allowed=True)

    def _create_approval(
        self, tenant_id: str, tool_id: str, payload: Dict[str, Any]
    ) -> str:
        ah = _h(redact(str(payload)))
        rec = Approval(
            tenant_id=uuid.UUID(str(tenant_id)),
            tool_id=tool_id,
            action_payload_hash=ah,
            action_payload_json=str(payload),
            status="pending",
        )
        self.db.add(rec)
        self.db.commit()
        # Audit request
        try:
            from ai_core.pipeline.audit_service import write_audit

            write_audit(
                self.db,
                tenant_id,
                None,
                "agent.approval.request",
                tool_id,
                str(payload),
                "",
                True,
                0,
                category="agent",
            )
        except Exception:
            pass
        return str(rec.id)
