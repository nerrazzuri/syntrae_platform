from __future__ import annotations

import secrets
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from shared.database.session import get_db
from sqlalchemy.orm import Session
from shared.database.models import ApiKey
from ai_core.api.deps import require
from shared.security.api_key import ApiKeyService


router = APIRouter(prefix="/v1/admin/api-keys", tags=["admin:api-keys"])


class ApiKeyCreateRequest(BaseModel):
    tenant_id: str
    name: str
    scopes: List[str]
    expires_in_days: Optional[int] = None
    rate_limit_per_minute: Optional[int] = 0


class ApiKeyResponse(BaseModel):
    id: str
    tenant_id: str
    name: str
    scopes: List[str]
    created_at: datetime
    expires_at: Optional[datetime] = None
    rate_limit_per_minute: int
    cleartext_key: Optional[str] = None  # only on creation/rotation


@router.post("/create", response_model=ApiKeyResponse)
def create_api_key(
    req: ApiKeyCreateRequest,
    db: Session = Depends(get_db),
    claims: Dict[str, Any] = Depends(require("admin:apikeys")),
):
    # Cross-tenant protection: only ADMIN of same tenant or global admin allowed
    if str(claims.get("role")) != "ADMIN":
        raise HTTPException(status_code=403, detail="Forbidden")
    # Generate clear key
    clear = secrets.token_urlsafe(32)
    h = ApiKeyService.hash_key(clear)
    expires_at = None
    if req.expires_in_days and req.expires_in_days > 0:
        expires_at = datetime.utcnow() + timedelta(days=req.expires_in_days)
    rec = ApiKey(
        tenant_id=req.tenant_id,
        name=req.name,
        key_hash=h,
        scopes=req.scopes,
        rate_limit_per_minute=int(req.rate_limit_per_minute or 0),
        expires_at=expires_at,
        created_by=claims.get("user_id"),
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return ApiKeyResponse(
        id=str(rec.id),
        tenant_id=str(rec.tenant_id),
        name=rec.name,
        scopes=rec.scopes or [],
        created_at=rec.created_at,
        expires_at=rec.expires_at,
        rate_limit_per_minute=rec.rate_limit_per_minute,
        cleartext_key=clear,
    )


@router.get("/list", response_model=List[ApiKeyResponse])
def list_api_keys(
    tenant_id: str,
    db: Session = Depends(get_db),
    claims: Dict[str, Any] = Depends(require("admin:apikeys")),
):
    q = db.query(ApiKey).filter(ApiKey.tenant_id == tenant_id).all()
    out: List[ApiKeyResponse] = []
    for r in q:
        out.append(
            ApiKeyResponse(
                id=str(r.id),
                tenant_id=str(r.tenant_id),
                name=r.name,
                scopes=r.scopes or [],
                created_at=r.created_at,
                expires_at=r.expires_at,
                rate_limit_per_minute=r.rate_limit_per_minute,
            )
        )
    return out


class ApiKeyRevokeRequest(BaseModel):
    id: str


@router.post("/revoke")
def revoke_api_key(
    req: ApiKeyRevokeRequest,
    db: Session = Depends(get_db),
    claims: Dict[str, Any] = Depends(require("admin:apikeys")),
):
    rec = db.get(ApiKey, req.id)
    if not rec:
        raise HTTPException(status_code=404, detail="Not found")
    rec.revoked_at = datetime.utcnow()
    db.add(rec)
    db.commit()
    return {"ok": True}
