from __future__ import annotations

from typing import Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import and_
import time
import uuid

from shared.database.models import (
    Tenant,
    TenantAction,
    TenantMigration,
)
from shared.plans.registry import resolve_plan_label, get_plan
from shared.metrics.tenant_lifecycle_metrics import (
    tenant_create_total,
    tenant_activate_total,
    tenant_upgrade_total,
    tenant_downgrade_total,
    tenant_migration_failures_total,
)
import os
from shared.vector.qdrant import QdrantService
from shared.utils.storage import write_metadata


class TenantManager:
    def __init__(self, db: Session):
        self.db = db

    def _log_action(self, tenant_id: str, action: str, status: str, reason: Optional[str] = None, extra: Optional[Dict[str, Any]] = None) -> str:
        rec = TenantAction(tenant_id=tenant_id, action=action, status=status, reason=reason, extra=extra or {})
        self.db.add(rec)
        self.db.commit()
        self.db.refresh(rec)
        return str(rec.id)

    def create(self, name: str, domain: str, plan: str) -> Dict[str, Any]:
        label = resolve_plan_label(plan)
        t = Tenant(name=name.strip(), domain=domain.strip(), subscription_tier=label.upper(), settings={})
        self.db.add(t)
        self.db.commit()
        self._log_action(str(t.id), "create", "completed")
        try:
            tenant_create_total.inc()
        except Exception:
            pass
        # Initialize tenant-scoped resources
        try:
            # Ensure Qdrant collections and payload indices exist (idempotent)
            QdrantService().create_collection()
        except Exception:
            pass
        try:
            # Prepare storage prefix directories
            base_path = os.getenv("DOCUMENT_STORAGE_PATH", os.path.join(os.getcwd(), "storage"))
            # write minimal metadata folder structure for sanity
            write_metadata(base_path, str(t.id), "bootstrap", {"tenant_id": str(t.id), "bootstrap": True})
        except Exception:
            pass
        # Mark inactive by default
        return {"tenant_id": str(t.id), "status": "inactive", "plan": label}

    def activate(self, tenant_id: str) -> Dict[str, Any]:
        t = self.db.query(Tenant).filter(Tenant.id == tenant_id).first()
        if not t:
            raise ValueError("tenant not found")
        self._log_action(tenant_id, "activate", "completed")
        try:
            tenant_activate_total.inc()
        except Exception:
            pass
        return {"tenant_id": tenant_id, "status": "active"}

    def suspend(self, tenant_id: str) -> Dict[str, Any]:
        self._log_action(tenant_id, "suspend", "completed")
        return {"tenant_id": tenant_id, "status": "suspended"}

    def resume(self, tenant_id: str) -> Dict[str, Any]:
        self._log_action(tenant_id, "resume", "completed")
        return {"tenant_id": tenant_id, "status": "active"}

    def upgrade(self, tenant_id: str, target_plan: str) -> Dict[str, Any]:
        t = self.db.query(Tenant).filter(Tenant.id == tenant_id).first()
        if not t:
            raise ValueError("tenant not found")
        frm = resolve_plan_label(t.subscription_tier)
        to = resolve_plan_label(target_plan)
        mig_type = "full" if (frm != "enterprise" and to == "enterprise") else "soft"
        m = TenantMigration(tenant_id=tenant_id, from_plan=frm, to_plan=to, migration_type=mig_type, status="pending")
        self.db.add(m)
        self.db.commit()
        try:
            tenant_upgrade_total.labels(frm, to).inc()
        except Exception:
            pass
        return {"tenant_id": tenant_id, "from": frm, "to": to, "migration_id": str(m.id)}

    def downgrade(self, tenant_id: str, target_plan: str) -> Dict[str, Any]:
        t = self.db.query(Tenant).filter(Tenant.id == tenant_id).first()
        if not t:
            raise ValueError("tenant not found")
        frm = resolve_plan_label(t.subscription_tier)
        to = resolve_plan_label(target_plan)
        if to == "enterprise":
            raise ValueError("cannot downgrade to enterprise")
        # Apply markers (over-limit resources handled by retention jobs)
        self._log_action(tenant_id, "downgrade", "pending", extra={"from": frm, "to": to})
        try:
            tenant_downgrade_total.labels(frm, to).inc()
        except Exception:
            pass
        # Update plan label (no data deletion)
        t.subscription_tier = to.upper()
        self.db.add(t)
        self.db.commit()
        self._log_action(tenant_id, "downgrade", "completed")
        return {"tenant_id": tenant_id, "from": frm, "to": to, "status": "active"}

    def delete(self, tenant_id: str) -> Dict[str, Any]:
        self._log_action(tenant_id, "delete", "scheduled")
        return {"tenant_id": tenant_id, "status": "scheduled"}

    def dry_run(self, tenant_id: str, target_plan: str) -> Dict[str, Any]:
        t = self.db.query(Tenant).filter(Tenant.id == tenant_id).first()
        if not t:
            raise ValueError("tenant not found")
        frm = resolve_plan_label(t.subscription_tier)
        to = resolve_plan_label(target_plan)
        mig_type = "full" if (frm != "enterprise" and to == "enterprise") else "soft"
        plan = get_plan(to)
        return {"tenant_id": tenant_id, "from": frm, "to": to, "type": mig_type, "estimated": {"duration_s": 120 if mig_type == "full" else 15, "steps": ["backup-check","pg-transfer","qdrant-snapshot","vault-dup","cutover","verify"]}, "limits": plan.get("limits", {})}

    # ---- Whitelabel / Custom Domain Management ----
    def begin_custom_domain(self, tenant_id: str, domain: str) -> Dict[str, Any]:
        t = self.db.query(Tenant).filter(Tenant.id == tenant_id).first()
        if not t:
            raise ValueError("tenant not found")
        d = (domain or "").strip().lower()
        # Simple subdomain validation: require at least one dot and not apex-like
        if not d or "." not in d:
            raise ValueError("invalid domain; subdomain required (e.g., ai.company.com)")
        # Set status and generate DNS TXT token for ownership
        t.custom_domain = d
        t.custom_domain_status = "pending_dns"
        s = dict(t.settings or {})
        s["domain_txt_token"] = s.get("domain_txt_token") or uuid.uuid4().hex
        t.settings = s
        self.db.add(t)
        self.db.commit()
        self._log_action(tenant_id, "custom_domain_begin", "pending", extra={"domain": d})
        return {"tenant_id": tenant_id, "custom_domain": d, "status": "pending_dns", "txt_token": s["domain_txt_token"]}

    def custom_domain_status(self, tenant_id: str) -> Dict[str, Any]:
        t = self.db.query(Tenant).filter(Tenant.id == tenant_id).first()
        if not t:
            raise ValueError("tenant not found")
        return {
            "tenant_id": tenant_id,
            "custom_domain": t.custom_domain,
            "custom_domain_status": t.custom_domain_status or "none",
            "ssl_cert_secret": t.ssl_cert_secret,
            "brand_assets_uri": t.brand_assets_uri,
        }

    def remove_custom_domain(self, tenant_id: str) -> Dict[str, Any]:
        t = self.db.query(Tenant).filter(Tenant.id == tenant_id).first()
        if not t:
            raise ValueError("tenant not found")
        prev = t.custom_domain
        t.custom_domain = None
        t.custom_domain_status = "none"
        t.ssl_cert_secret = None
        self.db.add(t)
        self.db.commit()
        self._log_action(tenant_id, "custom_domain_remove", "completed", extra={"domain": prev})
        return {"tenant_id": tenant_id, "removed": prev}


