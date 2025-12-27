from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from shared.database.session import SessionLocal
from shared.database.models import Tenant


router = APIRouter(prefix="/v1/admin/features", tags=["admin-features"])


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


class FeatureBody(BaseModel):
    tenant_id: str
    web_search_enabled: bool


@router.get("/get")
def get_features(tenant_id: str, request: Request, db: Session = Depends(get_db)):
    _require_admin(request)
    t = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="tenant not found")
    settings = t.settings or {}
    return {"tenant_id": tenant_id, "web_search_enabled": bool(settings.get("web_search_enabled", False))}


@router.post("/set")
def set_features(body: FeatureBody, request: Request, db: Session = Depends(get_db)):
    _require_admin(request)
    t = db.query(Tenant).filter(Tenant.id == body.tenant_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="tenant not found")
    s = t.settings or {}
    s["web_search_enabled"] = bool(body.web_search_enabled)
    t.settings = s
    db.add(t)
    db.commit()
    return {"ok": True}


