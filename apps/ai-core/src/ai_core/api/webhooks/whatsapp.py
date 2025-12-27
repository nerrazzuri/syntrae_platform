"""
WhatsApp webhook handler with basic HMAC validation hook.
"""
from fastapi import APIRouter, Request, HTTPException, status
from typing import Dict, Any
import hmac
import hashlib
import os
from shared.utils.message_utils import normalize_whatsapp

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


def verify_signature(body: bytes, signature: str, secret: str) -> bool:
    mac = hmac.new(secret.encode("utf-8"), msg=body, digestmod=hashlib.sha256)
    expected = mac.hexdigest()
    return hmac.compare_digest(expected, signature.replace("sha256=", ""))


@router.post("/whatsapp")
async def whatsapp_webhook(request: Request) -> Dict[str, Any]:
    secret = os.getenv("WHATSAPP_APP_SECRET", "")
    signature = request.headers.get("X-Hub-Signature-256", "")
    body = await request.body()
    if secret:
        if not signature or not verify_signature(body, signature, secret):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid signature"
            )

    payload = await request.json()
    normalized = normalize_whatsapp(payload)
    return {"status": "accepted", "normalized": normalized}
