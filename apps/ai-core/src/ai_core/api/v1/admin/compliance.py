from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import desc

from shared.database.session import SessionLocal
from shared.database.models import ComplianceReport, Tenant
from shared.config.tuning import compliance as compliance_cfg
from ai_core.services.compliance_reporter import ComplianceReporter
from ai_core.pipeline.audit_service import write_audit


router = APIRouter(prefix="/v1/admin/reports", tags=["admin-compliance"])


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


class GenerateBody(BaseModel):
    tenant_id: str


@router.get("/latest")
def latest(tenant_id: str, request: Request, db: Session = Depends(get_db)):
    _require_admin(request)
    rec = (
        db.query(ComplianceReport)
        .filter(ComplianceReport.tenant_id == tenant_id)
        .order_by(desc(ComplianceReport.created_at))
        .first()
    )
    if not rec:
        raise HTTPException(status_code=404, detail="no report")
    return {
        "id": str(rec.id),
        "tenant_id": str(rec.tenant_id),
        "artifact_path": rec.artifact_path,
        "checksum_sha256": rec.artifact_checksum_sha256,
        "status": rec.status,
        "generator_version": rec.generator_version,
        "period_start": rec.period_start.isoformat() if rec.period_start else None,
        "period_end": rec.period_end.isoformat() if rec.period_end else None,
        "summary": rec.summary or {},
        "signed_url": None,
    }


@router.get("/summary")
def summary(tenant_id: str, request: Request, db: Session = Depends(get_db)):
    _require_admin(request)
    rec = (
        db.query(ComplianceReport)
        .filter(ComplianceReport.tenant_id == tenant_id)
        .order_by(desc(ComplianceReport.created_at))
        .first()
    )
    if not rec:
        return {"overall": None, "noncompliant": None}
    s = rec.summary or {}
    return {"overall": s.get("overall"), "noncompliant": s.get("noncompliant")}


@router.post("/generate")
def generate(body: GenerateBody, request: Request, db: Session = Depends(get_db)):
    _require_admin(request)
    reporter = ComplianceReporter()
    result = reporter.generate_for_tenant(db, body.tenant_id)
    # Audit
    try:
        write_audit(
            db=db,
            tenant_id=body.tenant_id,
            user_id=None,
            action="admin:compliance.generate",
            resource="compliance",
            request_text=f"generate {body.tenant_id}",
            response_text=result.get("checksum") or "ok",
            success=True,
            latency_ms=0,
            category="admin",
            auth_type=str(getattr(request.state, "auth_type", "")),
            api_key_id=str(getattr(request.state, "api_key_id", "") or ""),
            correlation_id=str(getattr(request.state, "correlation_id", "") or ""),
        )
    except Exception:
        pass
    return {
        "ok": True,
        "path": result.get("path"),
        "checksum": result.get("checksum"),
        "scores": result.get("scores"),
    }


@router.post("/generate_all")
def generate_all(request: Request, db: Session = Depends(get_db)):
    _require_admin(request)
    reporter = ComplianceReporter()
    tenants = [str(t[0]) for t in db.query(Tenant.id).all()]
    out = []
    for tid in tenants:
        try:
            result = reporter.generate_for_tenant(db, tid)
            out.append({"tenant_id": tid, "ok": True, "checksum": result.get("checksum")})
        except Exception as _e:
            out.append({"tenant_id": tid, "ok": False, "error": str(_e)})
    return {"results": out}

