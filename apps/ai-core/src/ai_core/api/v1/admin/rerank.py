from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, conint
from typing import Dict, Any
from sqlalchemy.orm import Session

from shared.database.session import get_db
from shared.database.models import TenantRerankConfig
from ai_core.api.deps import require


router = APIRouter(prefix="/v1/admin/rerank", tags=["admin:rerank"])


class RerankWeightsIn(BaseModel):
    tenant_id: str
    w_bm25: conint(ge=0, le=100)
    w_dense: conint(ge=0, le=100)
    w_field_values: conint(ge=0, le=100)


@router.post("/set-weights")
def set_weights(
    body: RerankWeightsIn,
    db: Session = Depends(get_db),
    claims: Dict[str, Any] = Depends(require("admin:rerank")),
):
    if str(claims.get("role")) != "ADMIN":
        raise HTTPException(status_code=403, detail="Forbidden")
    rec = TenantRerankConfig(
        tenant_id=body.tenant_id,
        w_bm25=int(body.w_bm25),
        w_dense=int(body.w_dense),
        w_field_values=int(body.w_field_values),
        active=True,
    )
    # deactivate previous
    try:
        db.query(TenantRerankConfig).filter(
            TenantRerankConfig.tenant_id == body.tenant_id,
            TenantRerankConfig.active == True,
        ).update(
            {TenantRerankConfig.active: False}
        )  # noqa: E712
    except Exception:
        pass
    db.add(rec)
    db.commit()
    return {"ok": True}
