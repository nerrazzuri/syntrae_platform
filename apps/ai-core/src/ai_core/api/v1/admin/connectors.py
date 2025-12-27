from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from shared.database.session import SessionLocal
from ai_core.api.v1.admin.tenants import _require_admin
from ai_core.connectors.registry import registry
from shared.database.models import TenantConnector


router = APIRouter(prefix="/v1/admin/connectors", tags=["admin-connectors"])


def get_db():
    s = SessionLocal()
    try:
        yield s
    finally:
        try:
            s.close()
        except Exception:
            pass


@router.get("")
def list_all(request: Request):
    _require_admin(request)
    return {"available": registry.names()}


class ActivateBody(BaseModel):
    tenant_id: str
    connector_id: str


@router.post("/activate")
def activate(body: ActivateBody, request: Request, db: Session = Depends(get_db)):
    _require_admin(request)
    tc = db.query(TenantConnector).filter(TenantConnector.tenant_id == body.tenant_id, TenantConnector.connector_id == body.connector_id).first()
    if not tc:
        tc = TenantConnector(tenant_id=body.tenant_id, connector_id=body.connector_id, status="active")
    else:
        tc.status = "active"
    db.add(tc)
    db.commit()
    return {"ok": True}


