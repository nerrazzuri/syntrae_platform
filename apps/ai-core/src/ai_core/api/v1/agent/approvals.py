from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from typing import Optional
from shared.database.session import SessionLocal
from shared.database.models import Approval
from sqlalchemy.orm import Session
from shared.metrics.agent_tool_metrics import agent_tool_metrics
from sqlalchemy.sql import func as _func


router = APIRouter(prefix="/v1/agent/approvals", tags=["agent-approvals"])


def get_db():
    s = SessionLocal()
    try:
        yield s
    finally:
        try:
            s.close()
        except Exception:
            pass


class ApprovalRequest(BaseModel):
    tenant_id: str
    tool_id: str
    action_payload_hash: str
    requested_by: Optional[str] = None


class ApprovalDecision(BaseModel):
    approval_id: str
    status: str  # approved|denied
    reason: Optional[str] = None
    decided_by: Optional[str] = None


def _require_manage(request: Request):
    claims = getattr(request.state, "claims", {}) or {}
    scopes = set((claims.get("scopes") or []))
    role = (claims.get("role") or "").upper()
    if "agent:approval.manage" in scopes or role == "ADMIN":
        return True
    raise HTTPException(status_code=403, detail="forbidden")


@router.post("/request")
def create_request(
    req: ApprovalRequest, db: Session = Depends(get_db), request: Request = None
):
    rec = Approval(
        tenant_id=req.tenant_id,
        tool_id=req.tool_id,
        action_payload_hash=req.action_payload_hash,
        requested_by=req.requested_by,
        status="pending",
    )
    db.add(rec)
    db.commit()
    agent_tool_metrics.inc_approval_requested(req.tenant_id, req.tool_id)
    return {"approval_id": str(rec.id), "status": rec.status}


@router.post("/decide")
def decide(
    dec: ApprovalDecision, db: Session = Depends(get_db), request: Request = None
):
    if request:
        _require_manage(request)
    rec = db.get(Approval, dec.approval_id)
    if not rec:
        raise HTTPException(status_code=404, detail="approval not found")
    rec.status = "approved" if dec.status == "approved" else "denied"
    rec.reason = dec.reason
    rec.decided_by = dec.decided_by
    from sqlalchemy.sql import func as _func

    rec.decided_at = _func.now()
    db.add(rec)
    db.commit()
    if rec.status == "approved":
        agent_tool_metrics.inc_approval_granted(str(rec.tenant_id), rec.tool_id)
    # Audit decision
    try:
        from ai_core.pipeline.audit_service import write_audit

        write_audit(
            db,
            str(rec.tenant_id),
            None,
            "agent.approval.decision",
            rec.tool_id,
            rec.action_payload_hash,
            rec.status,
            True,
            0,
            category="agent",
        )
    except Exception:
        pass
    return {"status": rec.status}


@router.get("/list")
def list_approvals(
    tenant_id: str = Query(...),
    status: Optional[str] = Query(None),
    limit: int = Query(50),
    db: Session = Depends(get_db),
    request: Request = None,
):
    if request:
        _require_manage(request)
    q = db.query(Approval).filter(Approval.tenant_id == tenant_id)
    if status:
        q = q.filter(Approval.status == status)
    q = q.order_by(Approval.created_at.desc()).limit(min(200, max(1, limit)))
    rows = q.all()

    def _row(r: Approval):
        return {
            "id": str(r.id),
            "tool_id": r.tool_id,
            "status": r.status,
            "requested_by": str(r.requested_by) if r.requested_by else None,
            "created_at": str(r.created_at),
            "decided_at": str(r.decided_at) if r.decided_at else None,
            "executed": bool(r.executed),
            "executed_at": str(r.executed_at) if r.executed_at else None,
            "summary": (r.output_summary or "")[:300],
        }

    return [_row(r) for r in rows]


@router.get("/{approval_id}")
def get_approval(
    approval_id: str, db: Session = Depends(get_db), request: Request = None
):
    if request:
        _require_manage(request)
    rec = db.get(Approval, approval_id)
    if not rec:
        raise HTTPException(status_code=404, detail="not found")
    return {
        "id": str(rec.id),
        "tenant_id": str(rec.tenant_id),
        "tool_id": rec.tool_id,
        "status": rec.status,
        "requested_by": str(rec.requested_by) if rec.requested_by else None,
        "created_at": str(rec.created_at),
        "decided_at": str(rec.decided_at) if rec.decided_at else None,
        "executed": bool(rec.executed),
        "executed_at": str(rec.executed_at) if rec.executed_at else None,
        "summary": (rec.output_summary or "")[:500],
    }


@router.delete("/{approval_id}")
def delete_approval(
    approval_id: str, db: Session = Depends(get_db), request: Request = None
):
    if request:
        _require_manage(request)
    rec = db.get(Approval, approval_id)
    if not rec:
        raise HTTPException(status_code=404, detail="not found")
    from sqlalchemy.sql import func as _func

    rec.deleted_at = _func.now()
    db.add(rec)
    db.commit()
    return {"status": "deleted"}


@router.get("/stats")
def approvals_stats(
    tenant_id: str | None = Query(None),
    db: Session = Depends(get_db),
    request: Request = None,
):
    if request:
        _require_manage(request)
    q = db.query(Approval.status, _func.count(Approval.id))
    if tenant_id:
        q = q.filter(Approval.tenant_id == tenant_id)
    q = q.group_by(Approval.status)
    rows = q.all()
    by_status = {str(status): int(cnt) for status, cnt in rows}
    # pending execution queue size
    queue_count = (
        db.query(_func.count(Approval.id))
        .filter(
            Approval.status == "approved",
            Approval.executed == False,
            Approval.deleted_at == None,
        )
        .scalar()
    )  # noqa: E712
    return {"by_status": by_status, "queue_size": int(queue_count or 0)}
