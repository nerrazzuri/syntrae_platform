from __future__ import annotations

import time
import logging
from sqlalchemy.orm import Session
from sqlalchemy import and_
from shared.database.session import SessionLocal
from shared.database.models import TenantMigration
from shared.metrics.tenant_lifecycle_metrics import tenant_migration_duration_seconds, tenant_migration_failures_total


def process_once(db: Session) -> bool:
    mig = db.query(TenantMigration).filter(TenantMigration.status == "pending").order_by(TenantMigration.started_at.asc().nullsfirst()).first()
    if not mig:
        return False
    mig.status = "running"
    mig.started_at = __import__("datetime").datetime.utcnow()
    db.add(mig)
    db.commit()
    start = time.time()
    try:
        # Stubs for PG/Qdrant/Vault steps with checksums
        time.sleep(0.1)
        mig.status = "completed"
        mig.finished_at = __import__("datetime").datetime.utcnow()
        db.add(mig)
        db.commit()
        try:
            tenant_migration_duration_seconds.labels(mig.migration_type).observe(max(0.0, time.time() - start))
        except Exception:
            pass
    except Exception as e:
        db.rollback()
        try:
            tenant_migration_failures_total.labels(stage="run", reason=str(e)[:64]).inc()
        except Exception:
            pass
        mig.status = "failed"
        mig.error = str(e)
        db.add(mig)
        db.commit()
    return True


def loop(stop_flag: dict):
    log = logging.getLogger(__name__)
    while not stop_flag.get("stop"):
        s = SessionLocal()
        try:
            did = process_once(s)
        finally:
            try:
                s.close()
            except Exception:
                pass
        time.sleep(0.5 if did else 2.0)


