from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from typing import List
from sqlalchemy.orm import Session
from shared.database.session import SessionLocal
from shared.database.models import RetentionPolicy
from shared.config.tuning import retention_defaults as defaults


router = APIRouter(prefix="/v1/admin/retention", tags=["admin-retention"])


def get_db():
    s = SessionLocal()
    try:
        yield s
    finally:
        try:
            s.close()
        except Exception:
            pass


def _require_admin(request: Request):
    claims = getattr(request.state, "claims", {}) or {}
    role = (claims.get("role") or "").upper()
    scopes = set((claims.get("scopes") or []))
    if role == "ADMIN" or "governance:write" in scopes:
        return True
    raise HTTPException(status_code=403, detail="forbidden")


class PolicyUpdate(BaseModel):
    tenant_id: str
    data_type: str
    max_age_days: int
    archive_before_delete: bool
    encryption_required: bool = True


@router.get("/policies")
def list_policies(tenant_id: str, request: Request, db: Session = Depends(get_db)):
    _require_admin(request)
    q = db.query(RetentionPolicy).filter(RetentionPolicy.tenant_id == tenant_id)
    rows: List[RetentionPolicy] = list(q.all())
    return [
        {
            "id": str(r.id),
            "tenant_id": str(r.tenant_id),
            "data_type": r.data_type,
            "max_age_days": int(r.max_age_days or 0),
            "archive_before_delete": bool(r.archive_before_delete),
            "encryption_required": bool(r.encryption_required),
            "last_enforced_at": (str(r.last_enforced_at) if r.last_enforced_at else None),
        }
        for r in rows
    ]


@router.post("/update")
def update_policy(body: PolicyUpdate, request: Request, db: Session = Depends(get_db)):
    _require_admin(request)
    r = (
        db.query(RetentionPolicy)
        .filter(
            RetentionPolicy.tenant_id == body.tenant_id,
            RetentionPolicy.data_type == body.data_type,
        )
        .first()
    )
    if not r:
        r = RetentionPolicy(
            tenant_id=body.tenant_id,
            data_type=body.data_type,
        )
    r.max_age_days = int(body.max_age_days)
    r.archive_before_delete = bool(body.archive_before_delete)
    r.encryption_required = bool(body.encryption_required)
    db.add(r)
    db.commit()
    return {"ok": True}


@router.get("/status")
def status(request: Request):
    _require_admin(request)
    return {
        "dry_run": bool(defaults.dry_run),
        "interval_s": int(defaults.enforce_interval_s),
    }


