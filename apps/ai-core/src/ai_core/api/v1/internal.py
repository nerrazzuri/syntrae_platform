"""
Internal knowledge API with JWT-based RBAC.
"""
from fastapi import APIRouter, Depends, HTTPException, Header, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional, Dict, Any, List
from shared.database.session import get_db
from ai_core.services.internal_knowledge_service import InternalKnowledgeService
from shared.security.jwt import JWTService
import os
import logging

router = APIRouter(prefix="/v1/internal", tags=["internal-knowledge"])
jwt_service = JWTService()


def parse_bearer(auth: Optional[str]) -> str:
    if not auth:
        raise HTTPException(status_code=401, detail="Authorization required")
    parts = auth.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Invalid authorization header")
    return parts[1]


@router.get("/knowledge/list")
def list_knowledge(
    authorization: Optional[str] = Header(None), db: Session = Depends(get_db)
) -> List[Dict[str, Any]]:
    token = parse_bearer(authorization)
    payload = jwt_service.verify_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    role = payload.get("role", "END_USER")
    tenant_id = payload.get("tenant_id")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="tenant_id missing in token")
    svc = InternalKnowledgeService(db)
    return svc.list_documents(tenant_id=tenant_id, role=role)


@router.post("/knowledge/update")
def update_knowledge(
    body: Dict[str, Any],
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    token = parse_bearer(authorization)
    payload = jwt_service.verify_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    role = payload.get("role", "END_USER")
    doc_id = body.get("id")
    updates = body.get("updates", {})
    if not doc_id:
        raise HTTPException(status_code=400, detail="Missing id")
    svc = InternalKnowledgeService(db)
    try:
        return svc.update_document(role=role, document_id=doc_id, updates=updates)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


class SignalInferenceRequest(BaseModel):
    text: str
    existing_signals: Optional[List[str]] = []
    language: Optional[str] = "en"
    domain: Optional[str] = "unknown"


@router.post("/signal-inference")
async def inference_signal(
    payload: SignalInferenceRequest,
    request: Request,
):
    # 1. Enforce Internal Service Authentication
    # Requirement: X-Internal-Secret header must equal AI_CORE_INTERNAL_SECRET env var
    secret_header = request.headers.get("X-Internal-Secret")
    env_secret = os.getenv("AI_CORE_INTERNAL_SECRET")

    if not env_secret:
        # Configuration error - fail safe
        logger = logging.getLogger("ai_core.api.internal")
        logger.error("AI_CORE_INTERNAL_SECRET not configured")
        raise HTTPException(status_code=500, detail="Internal configuration error")

    if not secret_header or secret_header != env_secret:
        raise HTTPException(
            status_code=401, detail="Invalid or missing internal secret"
        )

    # 2. Enforce Tenant / Workspace Context
    # Requirement: X-Tenant-Id header is mandatory and trusted
    tenant_id = request.headers.get("X-Tenant-Id")
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Missing X-Tenant-Id header")

    # 3. Invoke Capability with Tenant Context
    cap = request.app.state.capabilities.get("signal_inference")
    if not cap:
        raise HTTPException(
            status_code=500, detail="Signal Inference capability not initialized"
        )

    from ai_core.contracts.capability_request import CapabilityRequest

    # Use request context for auditing
    trace_id = request.headers.get("X-Correlation-ID")
    user_id = request.headers.get("X-User-Id", "system")

    cap_req = CapabilityRequest(
        tenant_id=tenant_id,  # Trusted caller context (Canonical Name)
        user_id=user_id,
        roles=["internal"],
        channel="internal",
        input={
            "text": payload.text,
            "existing_signals": payload.existing_signals,
            "language": payload.language,
            "domain": payload.domain,
        },
        context={
            "plan": "enterprise",
            "allow_tools": False
            # Note: Future caching/memory MUST be namespaced by tenant_id
        },
        constraints={},
        trace_id=trace_id,
    )

    result = await cap.execute(cap_req)

    if result.kind == "error":
        raise HTTPException(
            status_code=500, detail=result.payload.get("error", "Unknown error")
        )

    return result.payload
