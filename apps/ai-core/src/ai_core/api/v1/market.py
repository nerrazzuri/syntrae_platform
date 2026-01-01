```python
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel
import os

from ai_core.services.market_match_service import MarketMatchService

async def verify_internal_secret(request: Request):
    secret = request.headers.get("X-Internal-Secret")
    # Also check snake_case or lowercase if forwarded by proxies, but standard is X-Internal-Secret
    expected = os.getenv("AI_CORE_INTERNAL_SECRET")
    if not expected:
         # Log warning?
         pass
    if not expected or secret != expected:
        raise HTTPException(status_code=401, detail="Invalid internal secret")

router = APIRouter(prefix="/v1/market", tags=["market"])
service = MarketMatchService()

class MarketScoreRequest(BaseModel):
    brand_id: str
    text: str
    hashtags: List[str] = []

class MarketScoreResponse(BaseModel):
    score: float
    reasons: List[str]
    is_match: bool
    profile_version: Optional[int]
    profile_id: Optional[str]
    threshold: float

@router.post("/score", response_model=MarketScoreResponse, dependencies=[Depends(verify_internal_secret)])
async def score_market_relevance(
    payload: MarketScoreRequest,
    # Auth? Usually internal usage or API Key.
    # verify_api_key might be used? Or internal checks.
    # For now, let's assume it's protected by the global middleware or gateway verification.
):
    """
    Score content against the brand's active Market Profile.
    """
    try:
        result = service.evaluate_relevance(
            brand_id=payload.brand_id,
            text=payload.text,
            hashtags=payload.hashtags
        )
        return MarketScoreResponse(**result)
    except Exception as e:
        # Log error
        print(f"Market Score Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
