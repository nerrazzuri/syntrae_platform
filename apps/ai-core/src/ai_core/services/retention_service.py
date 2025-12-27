from __future__ import annotations

from typing import List, Dict, Any
from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session
from sqlalchemy import and_
from shared.database.models import RetentionPolicy, ArchiveRegistry, AuditLog
from shared.metrics.retention_metrics import retention_metrics
from shared.config.tuning import retention_defaults as defaults


class RetentionService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def _policies_for_tenant(self, tenant_id: str) -> List[RetentionPolicy]:
        q = self.db.query(RetentionPolicy).filter(
            RetentionPolicy.tenant_id == tenant_id
        )
        return list(q.all())

    def enforce_for_tenant(self, tenant_id: str) -> Dict[str, Any]:
        now = datetime.now(timezone.utc)
        policies = self._policies_for_tenant(tenant_id)
        if not policies:
            policies = self._default_policies(tenant_id)
        results: Dict[str, int] = {"deleted": 0, "archived": 0}
        for p in policies:
            try:
                acted = self._enforce_policy(p, now)
                results["deleted"] += acted.get("deleted", 0)
                results["archived"] += acted.get("archived", 0)
            except Exception:
                retention_metrics.inc_error("enforce_policy")
        retention_metrics.set_lag(0)
        return results

    def _default_policies(self, tenant_id: str) -> List[RetentionPolicy]:
        def _rp(t: str, days: int) -> RetentionPolicy:
            return RetentionPolicy(
                tenant_id=tenant_id,
                data_type=t,
                max_age_days=days,
                archive_before_delete=True,
                encryption_required=True,
            )

        return [
            _rp("document", defaults.doc_days),
            _rp("audit_log", defaults.audit_days),
            _rp("feedback", defaults.feedback_days),
            _rp("conversation", defaults.conv_days),
            _rp("embedding_cache", defaults.embed_cache_days),
            _rp("cost_summary", defaults.cost_days),
        ]

    def _enforce_policy(
        self, p: RetentionPolicy, now: datetime
    ) -> Dict[str, int]:
        cutoff = now - timedelta(days=int(p.max_age_days or 0))
        deleted = 0
        archived = 0
        # Example: audit_log deletion
        if p.data_type == "audit_log":
            q = self.db.query(AuditLog).filter(
                and_(AuditLog.tenant_id == p.tenant_id, AuditLog.created_at < cutoff)
            )
            rows = list(q.all())
            if p.archive_before_delete and not defaults.dry_run:
                for r in rows:
                    self._archive_record(p.tenant_id, "audit_log", str(r.id))
                    archived += 1
            if not defaults.dry_run:
                for r in rows:
                    self.db.delete(r)
                self.db.commit()
            deleted += len(rows)
            retention_metrics.inc_deleted(p.tenant_id, p.data_type, len(rows))
            if archived:
                retention_metrics.inc_archived(
                    p.tenant_id, p.data_type, archived
                )
        p.last_enforced_at = now
        try:
            self.db.add(p)
            self.db.commit()
        except Exception:
            self.db.rollback()
        return {"deleted": deleted, "archived": archived}

    def _archive_record(self, tenant_id: str, system: str, object_id: str) -> None:
        # Placeholder: store reference only; upstream pipeline handles content
        rec = ArchiveRegistry(
            tenant_id=tenant_id,
            system=system,
            object_id=object_id,
            storage_path="s3://archive/placeholder",
        )
        try:
            self.db.add(rec)
            self.db.commit()
        except Exception:
            self.db.rollback()


