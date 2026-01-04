
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel
import os
import httpx
import logging

from ai_core.services.market_match_service import MarketMatchService

logger = logging.getLogger(__name__)

async def verify_internal_secret(request: Request):
    # Case-insensitive header lookup
    headers = {k.lower(): v for k, v in request.headers.items()}
    secret = headers.get("x-internal-secret") or headers.get("x_internal_secret") or headers.get("x-internal_secret")
    
    expected = os.getenv("AI_CORE_INTERNAL_SECRET")
    
    if not expected:
         # If no secret configured, fail closed or log warning. Fail closed for security.
         raise HTTPException(status_code=500, detail="Server misconfiguration: AI_CORE_INTERNAL_SECRET not set")
         
    if not secret or secret != expected:
        raise HTTPException(status_code=401, detail="Invalid internal secret")

router = APIRouter(prefix="/v1/market", tags=["market"])
service = MarketMatchService()

class MarketScoreRequest(BaseModel):
    # WF-3 dual-mode: automation_run_id (strict) OR brand_id (legacy, deprecated)
    automation_run_id: Optional[str] = None
    brand_id: Optional[str] = None
    
    # Content to score
    text: str
    hashtags: List[str] = []
    
    # Optional metadata
    video_id: Optional[str] = None
    video_url: Optional[str] = None

class DecisionReason(BaseModel):
    type: str
    detail: str
    weight: Optional[float] = None

class MarketScoreResponse(BaseModel):
    # WF-3: Explicit decision
    decision: str  # ACCEPT | REJECT | SKIP | ERROR
    
    score: Optional[float] = None  # WF-3.1: None for ERROR decisions
    reasons: List[DecisionReason]
    
    # WF-3.1: Evaluation tracking
    evaluation_performed: bool = True
    error_class: Optional[str] = None
    
    # Debug info
    debug: Dict[str, Any] = {}

@router.post("/score", response_model=MarketScoreResponse, dependencies=[Depends(verify_internal_secret)])
async def score_market_relevance(
    payload: MarketScoreRequest,
):
    """
    WF-3: Score content against immutable market profile snapshot.
    
    Decision Logic (Deterministic):
      if score >= accept_threshold → ACCEPT
      elif score <= reject_threshold → REJECT
      else → SKIP
    
    Threshold priority:
      1. snapshot.acceptance_threshold (if present)
      2. system default (0.6 accept, 0.3 reject)
    """
    
    # WF-3 Dual-Mode Validation
    if not payload.automation_run_id and not payload.brand_id:
        raise HTTPException(status_code=400, detail="Either automation_run_id or brand_id required")
    
    try:
        if payload.automation_run_id:
            # WF-3 STRICT MODE: Fetch snapshot from run
            snapshot = await _fetch_run_snapshot(payload.automation_run_id)
            logger.info(f"WF-3: Scoring against snapshot for run {payload.automation_run_id}")
        else:
            # LEGACY MODE (Deprecated)
            logger.warning(f"DEPRECATED: Using brand_id mode for scoring. Migrate to automation_run_id. brand_id={payload.brand_id}")
            snapshot = _fetch_latest_active_profile(payload.brand_id)
        
        # Score against snapshot
        result = service.evaluate_relevance_against_snapshot(
            snapshot=snapshot,
            text=payload.text,
            hashtags=payload.hashtags
        )
        
        # WF-3: Deterministic Decision Logic
        score = result.get("score", 0.0)
        accept_threshold = snapshot.get("acceptance_threshold", 0.6)
        reject_threshold = 0.3  # System default
        
        if score >= accept_threshold:
            decision =  "ACCEPT"
        elif score <= reject_threshold:
            decision = "REJECT"
        else:
            decision = "SKIP"
        
        return MarketScoreResponse(
            decision=decision,
            score=score,
            evaluation_performed=True,  # WF-3.1: Successful evaluation
            error_class=None,
            reasons=[
                DecisionReason(
                    type=r.get("type", "UNKNOWN"),
                    detail=r.get("detail", ""),
                    weight=r.get("weight")
                ) for r in result.get("reasons", [])
            ],
            debug={
                "profile_version": snapshot.get("version"),
                "matched_terms": result.get("matched_terms", []),
                "negative_hits": result.get("negative_hits", []),
                "thresholds": {
                    "accept": accept_threshold,
                    "reject": reject_threshold
                }
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Market Score Error: {e}", exc_info=True)
        # WF-3.1: Return structured ERROR on internal failures
        return MarketScoreResponse(
            decision="ERROR",
            score=None,
            evaluation_performed=False,
            error_class="AI_CORE_INTERNAL_ERROR",
            reasons=[DecisionReason(type="ERROR", detail=f"Internal error: {str(e)}", weight=None)],
            debug={}
        )

async def _fetch_run_snapshot(run_id: str) -> Dict[str, Any]:
    """
    WF-3: Fetch market_profile_snapshot from AutomationRun via Operator API.
    """
    operator_url = os.getenv("OPERATOR_API_URL", "http://operator-api:3001")
    internal_secret = os.getenv("AI_CORE_INTERNAL_SECRET")
    
    url = f"{operator_url}/internal/automation-run/{run_id}"
    headers = {"x-internal-secret": internal_secret}
    
    async with httpx.AsyncClient() as client:
        resp = await client.get(url, headers=headers, timeout=5.0)
        
        if resp.status_code == 404:
            raise HTTPException(status_code=404, detail=f"Run not found: {run_id}")
        elif resp.status_code == 409:
            raise HTTPException(status_code=409, detail=f"WF-1 violation: Run {run_id} missing market_profile_snapshot")
        elif resp.status_code == 422:
            raise HTTPException(status_code=422, detail=f"Snapshot malformed for run {run_id}")
        elif resp.status_code == 403:
            raise HTTPException(status_code=500, detail="Internal auth failure communicating with Operator API")
        elif resp.status_code != 200:
            raise HTTPException(status_code=500, detail=f"Failed to fetch run snapshot: {resp.status_code}")
        
        run = resp.json()
        snapshot = run.get("market_profile_snapshot")
        
        if not snapshot:
            raise HTTPException(status_code=409, detail=f"market_profile_snapshot missing in run {run_id}")
        
        return snapshot

def _fetch_latest_active_profile(brand_id: str) -> Dict[str, Any]:
    """
    LEGACY: Fetch latest active profile directly from DB.
    This path is deprecated and will be removed in Phase 40.
    """
    return service.get_latest_active_profile(brand_id)
