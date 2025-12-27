from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from shared.database.session import SessionLocal
from shared.metrics.backup_metrics import backup_metrics
from shared.metrics.qdrant_snapshot_metrics import qdrant_snapshot_metrics
import time


router = APIRouter(prefix="/v1/admin/backup", tags=["admin-backup"])


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
    if role == "ADMIN" or "backup:write" in scopes:
        return True
    try:
        backup_metrics.inc_auth_fail()
    except Exception:
        pass
    raise HTTPException(status_code=403, detail="forbidden")


class BackupMark(BaseModel):
    system: str  # postgres|redis|qdrant|vault
    status: str  # success|failure
    duration_ms: int | None = None
    size_bytes: int | None = None
    ts_unix: int | None = None
    collection: str | None = None
    checksum_sha256: str | None = None


@router.post("/mark")
def mark_backup(payload: BackupMark, request: Request, db: Session = Depends(get_db)):
    _require_admin(request)
    now = int(payload.ts_unix or time.time())
    ok = payload.status == "success"
    backup_metrics.mark(payload.system, ok, now, payload.duration_ms, payload.size_bytes)
    if ok and payload.system == "qdrant" and payload.collection:
        try:
            qdrant_snapshot_metrics.mark(payload.collection, int(payload.size_bytes or 0), now)
        except Exception:
            pass
    return {"ok": True}
