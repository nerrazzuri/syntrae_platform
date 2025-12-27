from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Dict, Any

from shared.database.session import SessionLocal
import os
from shared.database.models import Tenant, Approval, RetentionPolicy, CostSummary
from shared.database.session import set_tenant_context
from shared.security.vault_client import vault_client
from shared.vector.qdrant import QdrantService
from shared.queue.retry_queue import retry_queue
import shutil
import os as _os
import secrets as _secrets
from sqlalchemy.sql import func as _func
from sqlalchemy import text as _sql


router = APIRouter(prefix="/v1/admin/tenants", tags=["admin-tenants"])


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
    # Allow bypass only in dev/local/test WHEN explicitly enabled
    env = os.getenv("ENV", "dev").lower()
    bypass = os.getenv("AUTH_BYPASS_ENABLE", "").lower() in ("1", "true", "yes")
    if env in ("dev", "local", "test") and bypass:
        return True
    claims = getattr(request.state, "claims", {}) or {}
    role = (claims.get("role") or "").upper()
    scopes = set((claims.get("scopes") or []))
    if role == "ADMIN" or "governance:read" in scopes or "governance:write" in scopes:
        return True
    raise HTTPException(status_code=403, detail="forbidden")


@router.get("/list")
def list_tenants(request: Request, db: Session = Depends(get_db)):
    _require_admin(request)
    rows = db.query(Tenant).order_by(Tenant.created_at.asc()).all()

    def _row(t: Tenant) -> Dict[str, Any]:
        settings = t.settings or {}
        return {
            "id": str(t.id),
            "name": t.name,
            "domain": t.domain,
            "subscription_tier": t.subscription_tier,
            "web_search_enabled": bool(settings.get("web_search_enabled", False)),
            "created_at": str(t.created_at) if t.created_at else None,
            "updated_at": str(t.updated_at) if t.updated_at else None,
        }

    return [_row(t) for t in rows]


class TenantCreateBody(BaseModel):
    name: str
    domain: str
    subscription_tier: str | None = "BASIC"
    settings: dict | None = None


@router.post("/create")
def create_tenant(body: TenantCreateBody, request: Request, db: Session = Depends(get_db)):
    _require_admin(request)
    name = (body.name or "").strip()
    domain = (body.domain or "").strip()
    if not name or not domain:
        raise HTTPException(status_code=400, detail="name and domain are required")
    # enforce unique domain
    existing = db.query(Tenant).filter(Tenant.domain == domain).first()
    if existing:
        raise HTTPException(status_code=409, detail="domain already exists")
    t = Tenant(
        name=name,
        domain=domain,
        subscription_tier=body.subscription_tier or "BASIC",
        settings=body.settings or {},
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return {"id": str(t.id)}


@router.get("/summary")
def tenant_summary(tenant_id: str, request: Request, db: Session = Depends(get_db)):
    _require_admin(request)
    # Impersonation-safe read: set DB RLS tenant context
    try:
        set_tenant_context(tenant_id)
    except Exception:
        pass
    t = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="tenant not found")

    # Features
    settings = t.settings or {}
    features = {"web_search_enabled": bool(settings.get("web_search_enabled", False))}

    # Approvals stats
    rows = (
        db.query(Approval.status, _func.count(Approval.id))
        .filter(Approval.tenant_id == tenant_id)
        .group_by(Approval.status)
        .all()
    )
    approvals_by_status = {str(status): int(cnt) for status, cnt in rows}
    # Queue size (handle legacy schemas without executed/deleted_at)
    try:
        cols = []
        try:
            rows = db.execute(
                _sql(
                    "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name='approvals'"
                )
            ).fetchall()
            cols = [r[0] for r in rows]
            if not cols:
                rows2 = db.execute(
                    _sql(
                        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='approvals'"
                    )
                ).fetchall()
                cols = [r[0] for r in rows2]
        except Exception:
            cols = []

        q = db.query(_func.count(Approval.id)).filter(
            Approval.tenant_id == tenant_id, Approval.status == "approved"
        )
        if "executed" in cols:
            q = q.filter(Approval.executed == False)  # noqa: E712
        if "deleted_at" in cols:
            q = q.filter(Approval.deleted_at == None)  # noqa: E711
        queue_size = int(q.scalar() or 0)
    except Exception:
        queue_size = 0

    # Retention policies
    policies = (
        db.query(RetentionPolicy)
        .filter(RetentionPolicy.tenant_id == tenant_id)
        .order_by(RetentionPolicy.data_type.asc())
        .all()
    )
    retention = [
        {
            "data_type": p.data_type,
            "max_age_days": p.max_age_days,
            "archive_before_delete": bool(p.archive_before_delete),
            "encryption_required": bool(p.encryption_required),
            "last_enforced_at": str(p.last_enforced_at) if p.last_enforced_at else None,
        }
        for p in policies
    ]

    # Simple cost snapshot (sum over last 7 days)
    try:
        from datetime import datetime, timedelta

        window_start = datetime.utcnow() - timedelta(days=7)
        cs_rows = (
            db.query(
                _func.coalesce(_func.sum(CostSummary.tokens_in), 0),
                _func.coalesce(_func.sum(CostSummary.tokens_out), 0),
                _func.coalesce(_func.sum(CostSummary.cost_usd), 0),
            )
            .filter(CostSummary.tenant_id == tenant_id, CostSummary.window_start >= window_start)
            .one()
        )
        cost_snapshot = {
            "tokens_in": int(cs_rows[0] or 0),
            "tokens_out": int(cs_rows[1] or 0),
            "cost_cents": int(cs_rows[2] or 0),
        }
    except Exception:
        cost_snapshot = {"tokens_in": 0, "tokens_out": 0, "cost_cents": 0}

    return {
        "tenant": {
            "id": str(t.id),
            "name": t.name,
            "domain": t.domain,
            "subscription_tier": t.subscription_tier,
            "created_at": str(t.created_at) if t.created_at else None,
            "updated_at": str(t.updated_at) if t.updated_at else None,
        },
        "features": features,
        "approvals": {"by_status": approvals_by_status, "queue_size": int(queue_size)},
        "retention": retention,
        "cost": cost_snapshot,
    }


class TenantSecretsBody(BaseModel):
    # Write-only fields (masked on read): accept known keys
    OPENAI_API_KEY: str | None = None
    FILE_SIGNING_SECRET: str | None = None


@router.post("/{tenant_id}/secrets")
def update_tenant_secrets(tenant_id: str, body: TenantSecretsBody, request: Request):
    _require_admin(request)
    # Only allow in server environments where Vault is enabled
    if not vault_client.enabled:
        raise HTTPException(status_code=400, detail="Vault not enabled")
    payload: Dict[str, str] = {}
    for k in ("OPENAI_API_KEY", "FILE_SIGNING_SECRET"):
        v = getattr(body, k, None)
        if v:
            payload[k] = str(v)
    if not payload:
        raise HTTPException(status_code=400, detail="no secrets provided")
    ok = vault_client.put_all(prefix=f"tenants/{tenant_id}", data=payload)
    if not ok:
        raise HTTPException(status_code=500, detail="failed to update secrets")
    # Never return secret values
    return {"updated": list(payload.keys()), "tenant_id": tenant_id, "status": "ok"}


@router.post("/{tenant_id}/ops/purge-vectors")
def purge_vectors(tenant_id: str, request: Request):
    _require_admin(request)
    try:
        ok = QdrantService().delete_tenant_chunks(tenant_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"qdrant purge failed: {e}")
    return {"tenant_id": tenant_id, "purged_vectors": bool(ok)}


@router.post("/{tenant_id}/ops/purge-storage")
def purge_storage(tenant_id: str, request: Request):
    _require_admin(request)
    base = _os.getenv("DOCUMENT_STORAGE_PATH", _os.path.join(_os.getcwd(), "storage"))
    tenant_root = _os.path.join(base, f"tenant_{tenant_id}")
    try:
        if _os.path.isdir(tenant_root):
            shutil.rmtree(tenant_root, ignore_errors=True)
            return {"tenant_id": tenant_id, "purged_storage": True}
        return {"tenant_id": tenant_id, "purged_storage": False, "detail": "not found"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"storage purge failed: {e}")


@router.post("/{tenant_id}/ops/reindex")
def reindex_tenant(tenant_id: str, request: Request):
    _require_admin(request)
    try:
        retry_queue.enqueue("tenant_reindex", tenant_id, payload={"requested_by": "admin"})
        return {"tenant_id": tenant_id, "status": "scheduled"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"enqueue failed: {e}")


@router.post("/{tenant_id}/ops/rotate-signing-secret")
def rotate_signing_secret(tenant_id: str, request: Request):
    _require_admin(request)
    if not vault_client.enabled:
        raise HTTPException(status_code=400, detail="Vault not enabled")
    new_secret = _secrets.token_hex(32)
    ok = vault_client.put_all(prefix=f"tenants/{tenant_id}", data={"FILE_SIGNING_SECRET": new_secret})
    if not ok:
        raise HTTPException(status_code=500, detail="failed to rotate signing secret")
    return {"tenant_id": tenant_id, "rotated": "FILE_SIGNING_SECRET"}

