from __future__ import annotations

from fastapi import APIRouter, Request, HTTPException
from shared.plans.registry import list_plans

router = APIRouter(prefix="/v1/admin/plans", tags=["admin-plans"])


def _require_admin(request: Request):
    claims = getattr(request.state, "claims", {}) or {}
    role = (claims.get("role") or "").upper()
    scopes = set((claims.get("scopes") or []))
    if role == "ADMIN" or "governance:read" in scopes or "governance:write" in scopes:
        return True
    raise HTTPException(status_code=403, detail="forbidden")


@router.get("")
def get_plans(request: Request):
    _require_admin(request)
    return list_plans()


