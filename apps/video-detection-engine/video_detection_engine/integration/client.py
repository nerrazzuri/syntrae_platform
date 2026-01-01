
import httpx
import logging
import os
import json
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

class IntegrationClient:
    """
    Handles communication with Syntrae Platform services.
    Enforces the 'Relevance Loop' and 'Event Emission' pattern.
    """

    def __init__(self, brand_id: str, install_id: str):
        self.brand_id = brand_id
        self.install_id = install_id
        
        self.ai_core_url = os.getenv("AI_CORE_URL", "http://localhost:8000")
        self.ingestion_url = os.getenv("INGESTION_URL", "http://localhost:3000")
        self.internal_secret = os.getenv("AI_CORE_INTERNAL_SECRET", "dev-secret")
        
        # Ingestion requires X-Install-Secret? Or just X-Install-Id if we trust the runner?
        # The ingestion logic checks install_secret if present. 
        # For this phase, we assume the runner has the secret or we rely on IP whitelisting/network trust for internal runners.
        # But we should pass the secret if available.
        self.install_secret = os.getenv("INSTALL_SECRET", "default-secret")

    async def check_relevance(self, text: str, platform: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
        """
        Queries AI Core to determine if the content is relevant to the Brand.
        """
        url = f"{self.ai_core_url}/v1/internal/relevance/check"
        payload = {
            "brand_id": self.brand_id,
            "text": text,
            "platform": platform,
            "metadata": metadata
        }
        headers = {
            "X-Internal-Secret": self.internal_secret,
            "Content-Type": "application/json"
        }
        
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(url, json=payload, headers=headers, timeout=10.0)
                if resp.status_code == 200:
                    return resp.json()
                elif resp.status_code == 404:
                    logger.warning(f"Relevance check failed: Brand {self.brand_id} not found.")
                    return {"relevant": False, "reason": "Brand not found"}
                else:
                    logger.error(f"Relevance check error {resp.status_code}: {resp.text}")
                    return {"relevant": False, "reason": "API Error"}
        except Exception as e:
            logger.error(f"Relevance check exception: {e}")
            return {"relevant": False, "reason": "Client Exception"}

    async def emit_event(self, event_type: str, data: Dict[str, Any]):
        """
        Emits a standardized event to the Ingestion Service.
        """
        url = f"{self.ingestion_url}/events"
        
        # Map flat data to Schema structure (ingest.ts expect specific structure)
        # DesktopCaptureEventSchema structure:
        # { event_type: 'DESKTOP_CAPTURE', platform: ..., session: ..., page: ..., video: ..., comment: ... }
        
        # We need to construct this full payload from the partial data we have.
        # Ideally, 'data' passed here should already be formatted or we format it.
        # Let's assume 'data' is the raw extraction and we wrap it.
        
        payload = {
            "event_type": "DESKTOP_CAPTURE",
            "platform": data.get("platform", "unknown"),
            "session": {
                "session_id": "00000000-0000-0000-0000-000000000000", # Session ID is less relevant for automation
                "install_id": self.install_id,
                "brand_id": self.brand_id
            },
            "page": {
                "url": data.get("url", "unknown"),
                "page_type": "VIDEO",
                "timestamp": "2024-01-01T00:00:00.000Z" # TODO: Real time
            },
            "video": {
                "video_id": data.get("video_id", "unknown"),
                "video_url": data.get("url", ""),
                "title": data.get("title", ""),
                "author_id": data.get("author", "unknown"),
                "author_name": data.get("author", "unknown")
            },
            "comment": {
                "comment_id": data.get("comment_id", "unknown"),
                "author_id": data.get("comment_author_id", "unknown"),
                "text": data.get("content_text", ""),
                "reply_count": 0,
                "like_count": 0
            },
            "context": {
                "visible": True,
                "position": "viewport",
                "user_action": "manual_trigger" # Automation is manual trigger effectively
            },
            "client_meta": {
                "extension_version": "0.0.0-automation",
                "browser": "playwright",
                "os": "windows"
            }
        }

        headers = {
            "x-install-id": self.install_id,
            "x-install-secret": self.install_secret,
            "Content-Type": "application/json"
        }
        
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(url, json=payload, headers=headers, timeout=5.0)
                if resp.status_code not in (200, 201, 202):
                    logger.error(f"Event emission failed {resp.status_code}: {resp.text}")
                else:
                    logger.info(f"Event emitted: {resp.json().get('event_id')}")
        except Exception as e:
            logger.error(f"Event emission exception: {e}")
