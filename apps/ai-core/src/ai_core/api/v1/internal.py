"""
Internal knowledge API with JWT-based RBAC.
"""
from fastapi import APIRouter, Depends, HTTPException, Header, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional, Dict, Any, List
from shared.database.session import get_db
from ai_core.services.internal_knowledge_service import InternalKnowledgeService
from ai_core.services.draft_service import DraftGenerationService
from ai_core.pipeline.llm.llm_client import LLMClient
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


class GenerateDraftRequest(BaseModel):
    lead_id: str
    account_id: str
    force: bool = False
    owner_settings: Optional[Dict[str, Any]] = None


@router.post("/drafts/generate")
def generate_draft(
    payload: GenerateDraftRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    # Enforce Internal Service Authentication
    secret_header = request.headers.get("X-Internal-Secret")
    env_secret = os.getenv("AI_CORE_INTERNAL_SECRET")
    
    if not env_secret:
         raise HTTPException(status_code=500, detail="Internal configuration error")

    if not secret_header or secret_header != env_secret:
        raise HTTPException(status_code=401, detail="Invalid internal secret")

    # Enforce Account Scope
    account_header = request.headers.get("X-Account-Id")
    if not account_header:
         raise HTTPException(status_code=400, detail="Missing X-Account-Id header")
    
    if account_header != payload.account_id:
        raise HTTPException(status_code=403, detail="Account ID mismatch between header and payload")

    llm_client = LLMClient()
    svc = DraftGenerationService(db, llm_client)
    try:
        return svc.generate_draft(
            lead_id=payload.lead_id,
            account_id=payload.account_id,
            force=payload.force,
            owner_settings=payload.owner_settings
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

class RelevanceCheckRequest(BaseModel):
    brand_id: str
    text: str # Combined title + description + comments
    platform: str
    metadata: Optional[Dict[str, Any]] = {}

@router.post("/relevance/check")
async def check_relevance(
    payload: RelevanceCheckRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    # 1. Auth & Context
    secret_header = request.headers.get("X-Internal-Secret")
    env_secret = os.getenv("AI_CORE_INTERNAL_SECRET")
    if not env_secret or secret_header != env_secret:
        raise HTTPException(status_code=401, detail="Invalid internal secret")

    # 2. Fetch Brand Context
    from shared.database.models import Brand
    brand = db.query(Brand).filter(Brand.id == payload.brand_id).first()
    
    if not brand:
         # Fallback to permissive or strict? 
         # Strict: If brand unknown, we can't judge relevance.
         raise HTTPException(status_code=404, detail=f"Brand {payload.brand_id} not found")

    # 3. Construct Query from Brand Context
    # Context expected: { "niche": "Skin Care", "keywords": ["acne", "routine"] }
    context = brand.domain_context or {}
    niche = context.get("niche", "general")
    keywords = context.get("keywords", [])
    
    # Query: "Is this video relevant to {Niche} and {Keywords}?"
    # Better for CrossEncoder: "{Niche} {Keywords} high purchase intent"
    query = f"{niche} {' '.join(keywords)} high purchase intent"

    # 4. Score
    cap = request.app.state.capabilities.get("score")
    if not cap:
        raise HTTPException(status_code=500, detail="Score capability not ready")

    # We use ScoreCapability to rerank a single item against the query
    from ai_core.contracts.capability_request import CapabilityRequest
    
    cap_req = CapabilityRequest(
        tenant_id="system", # Internal
        user_id="automation_agent",
        roles=["internal"],
        channel="internal",
        input={
            "query": query,
            "retrieved": [payload.text] 
        },
        context={},
        trace_id=request.headers.get("X-Correlation-ID")
    )

    result = await cap.execute(cap_req)
    
    if result.kind == "error":
        raise HTTPException(status_code=500, detail="Scoring failed")

    # Payload is [{ "text": "...", "score": 0.9 }]
    scored_items = result.payload
    if not scored_items:
         return {"relevant": False, "confidence": 0.0, "reason": "No score returned"}

    top_item = scored_items[0]
    score = top_item.get("score", 0.0)
    
    # 5. Decision Logic
    # Threshold could be in Brand Context too
    threshold = context.get("relevance_threshold", 0.4) # Default conservative
    
    is_relevant = score >= threshold
    
    return {
        "relevant": is_relevant,
        "confidence": score,
        "reason": f"Score {score:.2f} >= {threshold} for niche {niche}"
    }
