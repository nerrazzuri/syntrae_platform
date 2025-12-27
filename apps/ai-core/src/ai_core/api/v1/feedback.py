from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Dict, Any, Optional
from sqlalchemy.orm import Session

from shared.database.session import get_db
from ai_core.api.deps import require
from ai_core.pipeline.feedback.feedback_service import FeedbackService


router = APIRouter(prefix="/v1/feedback", tags=["feedback"])


class FeedbackIn(BaseModel):
    tenant_id: str
    user_id: Optional[str] = None
    query: str
    predicted_intent: Optional[str] = None
    final_response: Optional[str] = None
    label: str
    meta: Optional[Dict[str, Any]] = None


@router.post("/submit")
def submit_feedback(
    body: FeedbackIn,
    db: Session = Depends(get_db),
    claims: Dict[str, Any] = Depends(require("conversation:write")),
):
    if str(claims.get("role")) != "ADMIN" and str(claims.get("tenant_id")) != str(
        body.tenant_id
    ):
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    svc = FeedbackService(db)
    fid = svc.add_event(
        body.tenant_id,
        body.user_id or claims.get("user_id"),
        body.query,
        body.predicted_intent,
        body.final_response,
        body.label,
        body.meta,
    )
    return {"id": fid}


@router.get("/list")
def list_feedback(
    tenant_id: str,
    limit: int = 100,
    db: Session = Depends(get_db),
    claims: Dict[str, Any] = Depends(require("conversation:read")),
):
    if str(claims.get("role")) != "ADMIN" and str(claims.get("tenant_id")) != str(
        tenant_id
    ):
        raise HTTPException(status_code=403, detail="Tenant mismatch")
    svc = FeedbackService(db)
    return svc.list_events(tenant_id, limit=limit)
