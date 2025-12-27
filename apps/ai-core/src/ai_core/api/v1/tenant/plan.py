from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session
from shared.database.session import get_db
from shared.database.models import Tenant
from shared.plans.registry import get_plan, resolve_plan_label
from ai_core.api.deps import require

router = APIRouter(prefix="/v1/tenant", tags=["tenant-plan"])


@router.get("/plan")
def get_tenant_plan(request: Request, db: Session = Depends(get_db), claims=Depends(require("retrieval:read"))):
    tenant_id = str(claims.get("tenant_id") or "")
    t = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    label = resolve_plan_label(t.subscription_tier if t else None)
    plan = get_plan(label)
    return {"plan_type": label, "plan": plan}


