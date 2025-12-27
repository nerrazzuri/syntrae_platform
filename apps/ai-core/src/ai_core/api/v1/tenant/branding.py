from fastapi import APIRouter, HTTPException, Request, Depends
from sqlalchemy.orm import Session

from shared.database.session import get_db
from shared.database.models import Tenant

router = APIRouter(prefix="/v1/tenant", tags=["tenant-branding"])


@router.get("/branding")
def get_branding(tenant_id: str, request: Request, db: Session = Depends(get_db)):
    # Require header tenant to match query for isolation (no admin scope required)
    header_tid = request.headers.get("X-Tenant-ID")
    if not tenant_id or not header_tid or str(header_tid) != str(tenant_id):
        raise HTTPException(status_code=403, detail="Tenant mismatch")

    t = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return {
        "tenant_id": str(t.id),
        "brand_assets_uri": t.brand_assets_uri or "",
        "csp_exceptions": t.csp_exceptions or [],
    }


