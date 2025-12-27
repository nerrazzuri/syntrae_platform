"""
Microsoft Teams webhook handler.
"""
from fastapi import APIRouter, Request, HTTPException
from typing import Dict, Any
from shared.services.session_service import SessionService
from shared.utils.channel_adapter import ChannelAdapter

router = APIRouter(prefix="/webhooks", tags=["webhooks"])
session_service = SessionService()
adapter = ChannelAdapter()


@router.post("/teams")
async def teams_webhook(request: Request) -> Dict[str, Any]:
    payload = await request.json()
    # Extract tenant and user identifiers (simplified for demo); in prod validate tenant binding
    tenant_id = payload.get("tenantId") or "00000000-0000-0000-0000-000000000000"
    user_identifier = adapter.extract_identifier("teams", payload)
    if not user_identifier:
        raise HTTPException(status_code=400, detail="Invalid Teams payload")
    session_id = session_service.get_or_create_session(tenant_id, user_identifier)
    session_service.set_channel_mapping(tenant_id, session_id, "teams", user_identifier)
    return {"status": "accepted", "sessionId": session_id}
