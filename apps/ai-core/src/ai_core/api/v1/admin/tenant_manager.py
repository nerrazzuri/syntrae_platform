from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from shared.database.session import SessionLocal
from ai_core.services.tenant_manager import TenantManager
from ai_core.api.v1.admin.tenants import _require_admin  # reuse admin guard
from shared.database.models import TenantAction, TenantMigration


router = APIRouter(prefix="/v1/admin/tenants", tags=["admin-tenant-manager"])


def get_db():
    s = SessionLocal()
    try:
        yield s
    finally:
        try:
            s.close()
        except Exception:
            pass


class CreateBody(BaseModel):
    name: str
    plan_type: str
    domain: str


@router.post("")
def create(body: CreateBody, request: Request, db: Session = Depends(get_db)):
    _require_admin(request)
    tm = TenantManager(db)
    return tm.create(body.name, body.domain, body.plan_type)


@router.post("/{tenant_id}/activate")
def activate(tenant_id: str, request: Request, db: Session = Depends(get_db)):
    _require_admin(request)
    tm = TenantManager(db)
    return tm.activate(tenant_id)


class PlanBody(BaseModel):
    target_plan: str


@router.post("/{tenant_id}/upgrade")
def upgrade(tenant_id: str, body: PlanBody, request: Request, db: Session = Depends(get_db)):
    _require_admin(request)
    tm = TenantManager(db)
    return tm.upgrade(tenant_id, body.target_plan)


@router.post("/{tenant_id}/downgrade")
def downgrade(tenant_id: str, body: PlanBody, request: Request, db: Session = Depends(get_db)):
    _require_admin(request)
    tm = TenantManager(db)
    return tm.downgrade(tenant_id, body.target_plan)


@router.post("/{tenant_id}/suspend")
def suspend(tenant_id: str, request: Request, db: Session = Depends(get_db)):
    _require_admin(request)
    tm = TenantManager(db)
    return tm.suspend(tenant_id)


@router.post("/{tenant_id}/resume")
def resume(tenant_id: str, request: Request, db: Session = Depends(get_db)):
    _require_admin(request)
    tm = TenantManager(db)
    return tm.resume(tenant_id)


@router.delete("/{tenant_id}")
def delete(tenant_id: str, request: Request, db: Session = Depends(get_db)):
    _require_admin(request)
    tm = TenantManager(db)
    return tm.delete(tenant_id)


@router.get("/{tenant_id}/dry-run")
def dry_run(tenant_id: str, target_plan: str, request: Request, db: Session = Depends(get_db)):
    _require_admin(request)
    tm = TenantManager(db)
    return tm.dry_run(tenant_id, target_plan)


@router.get("/{tenant_id}/status")
def status(tenant_id: str, request: Request, db: Session = Depends(get_db)):
    _require_admin(request)
    acts = (
        db.query(TenantAction)
        .filter(TenantAction.tenant_id == tenant_id)
        .order_by(TenantAction.created_at.desc())
        .limit(25)
        .all()
    )
    mig = (
        db.query(TenantMigration)
        .filter(TenantMigration.tenant_id == tenant_id)
        .order_by(TenantMigration.started_at.desc().nullsfirst())
        .limit(10)
        .all()
    )
    return {
        "actions": [
            {
                "id": str(a.id),
                "action": a.action,
                "status": a.status,
                "reason": a.reason,
                "created_at": str(a.created_at),
            }
            for a in acts
        ],
        "migrations": [
            {
                "id": str(m.id),
                "from": m.from_plan,
                "to": m.to_plan,
                "type": m.migration_type,
                "status": m.status,
                "started_at": str(m.started_at) if m.started_at else None,
                "finished_at": str(m.finished_at) if m.finished_at else None,
            }
            for m in mig
        ],
    }


# ---- Custom Domain (Whitelabel) ----
class DomainBody(BaseModel):
    domain: str


@router.post("/{tenant_id}/custom-domain")
def custom_domain_begin(tenant_id: str, body: DomainBody, request: Request, db: Session = Depends(get_db)):
    _require_admin(request)
    tm = TenantManager(db)
    return tm.begin_custom_domain(tenant_id, body.domain)


@router.get("/{tenant_id}/custom-domain/status")
def custom_domain_status(tenant_id: str, request: Request, db: Session = Depends(get_db)):
    _require_admin(request)
    tm = TenantManager(db)
    return tm.custom_domain_status(tenant_id)


@router.delete("/{tenant_id}/custom-domain")
def custom_domain_remove(tenant_id: str, request: Request, db: Session = Depends(get_db)):
    _require_admin(request)
    tm = TenantManager(db)
    return tm.remove_custom_domain(tenant_id)


