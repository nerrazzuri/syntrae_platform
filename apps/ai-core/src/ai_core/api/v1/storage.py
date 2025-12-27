from __future__ import annotations

import os
from typing import Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse

from shared.database.session import get_db
from ai_core.api.deps import require
from shared.storage.signed_url import verify_rid, sign_rid
from shared.metrics.security_metrics import invalid_signature_total, cross_tenant_blocked

router = APIRouter(prefix="/v1/storage", tags=["storage"])


@router.get("/download")
def download_signed(
    rid: str = Query(..., description="resource id relative to storage root"),
    exp: int = Query(..., description="expiry epoch seconds"),
    sig: str = Query(..., description="HMAC signature"),
    claims: Dict[str, Any] = Depends(require("document:read")),
):
    tenant_id = str(claims.get("tenant_id") or "")
    if not tenant_id:
        invalid_signature_total.labels("/v1/storage/download").inc()
        raise HTTPException(status_code=401, detail="Unauthorized")
    # Ensure rid stays within tenant namespace
    expected_prefix = f"tenant_{tenant_id}/"
    if not (rid and rid.startswith(expected_prefix)):
        cross_tenant_blocked.labels("/v1/storage/download").inc()
        raise HTTPException(status_code=403, detail="Forbidden")
    ok, reason = verify_rid(rid, tenant_id, exp, sig)
    if not ok:
        invalid_signature_total.labels("/v1/storage/download").inc()
        return JSONResponse(status_code=401, content={"detail": f"invalid signature: {reason}"})
    base_path = os.getenv("DOCUMENT_STORAGE_PATH", os.path.join(os.getcwd(), "storage"))
    file_path = os.path.join(base_path, rid.replace("/", os.sep))
    # For safety, allow only metadata.json downloads
    if not file_path.endswith("metadata.json"):
        cross_tenant_blocked.labels("/v1/storage/download").inc()
        raise HTTPException(status_code=403, detail="Forbidden")
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(file_path, media_type="application/json")


@router.get("/sign/metadata")
def sign_metadata(
    document_id: str = Query(...),
    claims: Dict[str, Any] = Depends(require("document:read")),
):
    tenant_id = str(claims.get("tenant_id") or "")
    if not tenant_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    rid = f"tenant_{tenant_id}/documents/{document_id}/metadata.json"
    import time as _time

    exp = int(_time.time()) + 300  # 5 minutes
    sig = sign_rid(rid, tenant_id, exp)
    return {"rid": rid, "exp": exp, "sig": sig, "url": f"/v1/storage/download?rid={rid}&exp={exp}&sig={sig}"}


