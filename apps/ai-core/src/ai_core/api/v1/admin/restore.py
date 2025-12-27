from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from shared.database.session import SessionLocal
from shared.metrics.restore_metrics import restore_metrics


router = APIRouter(prefix="/v1/admin/restore", tags=["admin-restore"])


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
    if role == "ADMIN" or "restore:write" in scopes:
        return True
    raise HTTPException(status_code=403, detail="forbidden")


class RestoreMark(BaseModel):
    ok: bool
    duration_seconds: int
    rto_compliant: bool
    rpo_compliant: bool


@router.post("/mark")
def mark_restore(payload: RestoreMark, request: Request, db: Session = Depends(get_db)):
    _require_admin(request)
    restore_metrics.mark(payload.ok, payload.duration_seconds, payload.rto_compliant, payload.rpo_compliant)
    return {"ok": True}


