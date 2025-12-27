from __future__ import annotations

import time
import logging
from typing import Dict, Any
from sqlalchemy.orm import Session

from shared.database.session import SessionLocal
from shared.database.models import TenantConnector, ConnectorSyncRecord, Tenant
from ai_core.connectors.registry import registry
from shared.plans.registry import resolve_plan_label, get_plan
from shared.metrics.connector_metrics import connector_sync_total


def _inc(label: str, connector: str, tenant: str, status: str):
    try:
        connector_sync_total.labels(plan_type=label, connector=connector, tenant_id=tenant, status=status).inc()
    except Exception:
        pass


def run_once(db: Session) -> bool:
    tc = (
        db.query(TenantConnector)
        .filter(TenantConnector.status == "active")
        .order_by(TenantConnector.updated_at.asc())
        .first()
    )
    if not tc:
        return False
    tenant_id = str(tc.tenant_id)
    connector_id = tc.connector_id
    # plan label
    label = "free"
    try:
        t = db.query(Tenant).filter(Tenant.id == tenant_id).first()
        label = resolve_plan_label(getattr(t, "subscription_tier", None))
    except Exception:
        pass
    spec = registry.spec(connector_id) or {}
    # Record sync
    rec = ConnectorSyncRecord(tenant_id=tenant_id, connector_id=connector_id)
    db.add(rec)
    db.commit()
    try:
        # Placeholder: actual authenticate/fetch/transform/ingest done in connector implementation
        time.sleep(0.05)
        rec.success = True
        rec.finished_at = __import__("datetime").datetime.utcnow()
        rec.record_count = 0
        rec.bytes = 0
        db.add(rec)
        db.commit()
        _inc(label, connector_id, tenant_id, "ok")
    except Exception as e:
        rec.success = False
        rec.errors = {"error": str(e)}
        db.add(rec)
        db.commit()
        _inc(label, connector_id, tenant_id, "error")
    return True


def loop(stop_flag: dict):
    log = logging.getLogger(__name__)
    # Load specs
    try:
        registry.load_specs("backend/src/ai_core/connectors/specs")
    except Exception:
        pass
    while not stop_flag.get("stop"):
        s = SessionLocal()
        try:
            did = run_once(s)
        finally:
            try:
                s.close()
            except Exception:
                pass
        time.sleep(0.5 if did else 2.0)


