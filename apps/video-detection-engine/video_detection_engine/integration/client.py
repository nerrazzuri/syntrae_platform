
import httpx
import logging
import os
import json
from typing import Dict, Any, Optional, List

logger = logging.getLogger(__name__)

class IntegrationClient:
    """
    Handles communication with Syntrae Platform services.
    Enforces the 'Relevance Loop' and 'Event Emission' pattern.
    """

    def __init__(self, brand_id: str, install_id: str):
        self.brand_id = brand_id
        self.install_id = install_id
        self.claim_token: Optional[str] = None
        
        self.ai_core_url = os.getenv("AI_CORE_BASE_URL")
        if not self.ai_core_url:
            raise RuntimeError("AI_CORE_BASE_URL is not set")

        self.ai_core_url = self.ai_core_url.rstrip("/")
        self.ingestion_url = os.getenv("INGESTION_URL", "http://localhost:3000")
        self.operator_url = os.getenv("OPERATOR_API_URL", "http://operator-api:3001")
        self.internal_secret = os.getenv("AI_CORE_INTERNAL_SECRET")
        if not self.internal_secret:
            raise RuntimeError("AI_CORE_INTERNAL_SECRET is not set")
        # Ingestion requires X-Install-Secret? Or just X-Install-Id if we trust the runner?
        # The ingestion logic checks install_secret if present. 
        # For this phase, we assume the runner has the secret or we rely on IP whitelisting/network trust for internal runners.
        # But we should pass the secret if available.
        self.install_secret = os.getenv("INSTALL_SECRET")

    def set_claim_context(self, claim_token: Optional[str]):
        self.claim_token = claim_token

    async def get_policy(self, brand_id: str) -> Dict[str, Any]:
        """
        Fetches the ACTIVE automation policy for the brand.
        """
        # Note: Access control assumes Install-ID validation or Internal Network trust.
        # Implemented in Operator API to allow x-install-id header.
        url = f"{self.operator_url}/brands/{brand_id}/automation-policy"
        headers = {
            "x-install-id": self.install_id,
            "x-internal-secret": self.internal_secret, # Pass this too just in case
            "Content-Type": "application/json"
        }
        
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(url, headers=headers, timeout=5.0)
                if resp.status_code == 200:
                    return resp.json()
                elif resp.status_code == 404:
                    logger.warning(f"Policy not found for Brand {brand_id}. Using Defaults.")
                    return {} # Caller handles default
                else:
                    logger.error(f"Failed to fetch policy {resp.status_code}: {resp.text}")
                    return None
        except Exception as e:
            logger.error(f"Policy fetch exception: {e}")
            return None

    async def create_run(self, policy_id: str, policy_snapshot: Dict[str, Any], platform: str) -> Optional[str]:
        """
        Creates an AutomationRun record in Operator API.
        Returns the run_id if successful.
        """
        url = f"{self.operator_url}/brands/{self.brand_id}/automation-runs"
        headers = {
            "x-install-id": self.install_id,
            "x-internal-secret": self.internal_secret,
            "Content-Type": "application/json"
        }
        payload = {
            "install_id": self.install_id,
            "platform": platform,
            "policy_id": policy_id,
            "policy_snapshot": policy_snapshot
        }
        
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(url, json=payload, headers=headers, timeout=5.0)
                if resp.status_code == 200:
                    data = resp.json()
                    run_id = data.get("id")
                    logger.info(f"Created AutomationRun: {run_id}")
                    return run_id
                else:
                    logger.error(f"Failed to create run {resp.status_code}: {resp.text}")
                    return None
        except Exception as e:
            logger.error(f"Create run exception: {e}")
            return None

    # ==========================
    # WF-1 Internal Methods (Strict Internal Secret)
    # ==========================
    async def get_policy_internal(self) -> Dict[str, Any]:
        """
        WF-1: Fetches policy using internal non-session endpoint.
        """
        url = f"{self.operator_url}/internal/automation-policy/latest?brand_id={self.brand_id}"
        headers = { "x-internal-secret": self.internal_secret, "Content-Type": "application/json" }
        return await self._internal_get(url, headers, "Policy")

    async def get_market_profile_internal(self) -> Dict[str, Any]:
        """
        WF-1: Fetches market profile using internal non-session endpoint.
        """
        url = f"{self.operator_url}/internal/market-profile/latest?brand_id={self.brand_id}"
        headers = { "x-internal-secret": self.internal_secret, "Content-Type": "application/json" }
        return await self._internal_get(url, headers, "MarketProfile")

    async def create_run_internal(self, policy_snapshot: Dict, market_profile_snapshot: Dict, platform: str) -> Optional[str]:
        """
        WF-1: Atomic Run Creation.
        """
        url = f"{self.operator_url}/internal/automation-run"
        headers = { "x-internal-secret": self.internal_secret, "Content-Type": "application/json" }
        
        payload = {
            "brand_id": self.brand_id,
            "install_id": self.install_id,
            "platform": platform,
            "discovery_mode": "MANUAL_URL", # Default for now
            "policy_snapshot": policy_snapshot,
            "market_profile_snapshot": market_profile_snapshot
        }

        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(url, json=payload, headers=headers, timeout=5.0)
                if resp.status_code == 201:
                    run_id = resp.json().get("id")
                    logger.info(f"WF-1: Created Internal AutomationRun: {run_id}")
                    return run_id
                else:
                    logger.error(f"WF-1: Run Start Failed {resp.status_code}: {resp.text}")
                    return None
        except Exception as e:
            logger.error(f"WF-1: Run Start Exception: {e}")
            return None

    async def start_claimed_run_internal(
        self,
        run_id: str,
        claim_token: str,
        policy_snapshot: Dict,
        market_profile_snapshot: Dict,
        platform: str,
        discovery_mode: str = "FEED_SCROLL"
    ) -> bool:
        """
        Attaches execution snapshots to a previously claimed queued run.
        """
        url = f"{self.operator_url}/internal/automation-run/{run_id}/start"
        headers = { "x-internal-secret": self.internal_secret, "Content-Type": "application/json" }
        payload = {
            "worker_id": self.install_id,
            "claim_token": claim_token,
            "platform": platform,
            "discovery_mode": discovery_mode,
            "policy_snapshot": policy_snapshot,
            "market_profile_snapshot": market_profile_snapshot
        }

        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(url, json=payload, headers=headers, timeout=10.0)
                if resp.status_code == 200:
                    logger.info(f"WF-1: Started claimed AutomationRun: {run_id}")
                    return True
                logger.error(f"WF-1: Claimed run start failed {resp.status_code}: {resp.text}")
                return False
        except Exception as e:
            logger.error(f"WF-1: Claimed run start exception: {e}")
            return False

    async def _internal_get(self, url: str, headers: Dict, resource_name: str) -> Optional[Dict]:
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(url, headers=headers, timeout=5.0)
                if resp.status_code == 200:
                    return resp.json()
                elif resp.status_code == 404:
                    logger.warning(f"WF-1: {resource_name} not found.")
                    return None
                else:
                    logger.error(f"WF-1: Failed to fetch {resource_name} {resp.status_code}: {resp.text}")
                    return None
        except Exception as e:
            logger.error(f"WF-1: {resource_name} fetch exception: {e}")
            return None
    
    async def _post_internal(self, url: str, payload: Dict[str, Any]):
        headers = {
            "x-internal-secret": self.internal_secret,
            "Content-Type": "application/json"
        }

        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(url, json=payload, headers=headers, timeout=5.0)
                if resp.status_code not in (200, 201):
                    logger.error(f"WF-3.1: Internal POST failed {resp.status_code}: {resp.text}")
        except Exception as e:
            logger.error(f"WF-3.1: Internal POST exception: {e}")

    async def claim_next_run(self, lease_seconds: int = 120) -> Optional[Dict[str, Any]]:
        """
        Atomically claims the next runnable queued automation job.
        """
        url = f"{self.operator_url}/internal/automation-runs/claim"
        headers = {
            "x-internal-secret": self.internal_secret,
            "Content-Type": "application/json"
        }
        payload = {
            "worker_id": self.install_id,
            "lease_seconds": lease_seconds
        }

        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(url, json=payload, headers=headers, timeout=10.0)
                if resp.status_code == 200:
                    body = resp.json()
                    return body if body else None
                logger.error(f"Failed to claim automation run {resp.status_code}: {resp.text}")
                return None
        except Exception as e:
            logger.error(f"Claim automation run exception: {e}")
            return None

    async def heartbeat_claimed_run(self, run_id: str, claim_token: str, lease_seconds: int = 120) -> bool:
        """
        Renews the worker lease for a claimed queued job.
        """
        url = f"{self.operator_url}/internal/automation-run/{run_id}/heartbeat"
        headers = {
            "X-Internal-Secret": self.internal_secret,
            "Content-Type": "application/json"
        }
        payload = {
            "worker_id": self.install_id,
            "claim_token": claim_token,
            "lease_seconds": lease_seconds
        }

        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(url, json=payload, headers=headers, timeout=10.0)
                if resp.status_code == 200:
                    return True
                logger.error(f"Failed to heartbeat automation run {run_id}: {resp.status_code} {resp.text}")
                return False
        except Exception as e:
            logger.error(f"Heartbeat automation run exception: {e}")
            return False

    async def sweep_stale_runs(
        self,
        stale_minutes: int = 10,
        retry_delay_seconds: int = 30,
        max_attempts: int = 3,
        limit: int = 25
    ) -> Optional[Dict[str, Any]]:
        """
        Requeues or fails stale automation runs that have lost their worker lease.
        """
        url = f"{self.operator_url}/internal/automation-runs/sweep-stale"
        headers = {
            "X-Internal-Secret": self.internal_secret,
            "Content-Type": "application/json"
        }
        payload = {
            "stale_minutes": stale_minutes,
            "retry_delay_seconds": retry_delay_seconds,
            "max_attempts": max_attempts,
            "limit": limit
        }

        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(url, json=payload, headers=headers, timeout=10.0)
                if resp.status_code == 200:
                    return resp.json()
                logger.error(f"Failed to sweep stale automation runs {resp.status_code}: {resp.text}")
                return None
        except Exception as e:
            logger.error(f"Stale automation sweep exception: {e}")
            return None

    async def check_relevance(self, text: str, platform: str, metadata: Dict[str, Any]) -> Dict[str, Any]:
        """
        Queries AI Core to determine if the content is relevant to the Brand.
        Returns Dict with keys: relevant (bool), confidence (float), reason (str), normalization (dict).
        """
        # Note: metadata can contain video checks or author info 
        
        # URL = internal endpoint
        url = f"{self.ai_core_url}/v1/internal/relevance/check"
        payload = {
            "brand_id": self.brand_id,
            "text": text,
            "platform": platform,
            "metadata": metadata
        }
        
        headers = {
            "X-Internal-Secret": self.internal_secret,
            "X-Correlation-ID": f"auto-{self.install_id}"
        }
        
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(url, json=payload, headers=headers, timeout=5.0)
                if resp.status_code == 200:
                    return resp.json() 
                else:
                    logger.error(f"Relevance check failed {resp.status_code}: {resp.text}")
                    return {"relevant": False, "confidence": 0.0, "reason": "API Error"}
        except Exception as e:
            logger.error(f"Relevance check exception: {e}")
            return {"relevant": False, "confidence": 0.0, "reason": "Exception"}

    async def record_discovery(self, run_id: str, discovery_data: Dict[str, Any]):
        """
        Persists DiscoveredVideo record.
        """
        url = f"{self.operator_url}/runs/{run_id}/discovery"
        headers = {
            "x-install-id": self.install_id,
            "x-internal-secret": self.internal_secret,
            "Content-Type": "application/json"
        }
        
        payload = discovery_data.copy()
        payload["brand_id"] = self.brand_id
        
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(url, json=payload, headers=headers, timeout=5.0)
                if resp.status_code != 200:
                    logger.error(f"Failed to record discovery {resp.status_code}: {resp.text}")
        except Exception as e:
            logger.error(f"Record discovery exception: {e}")

    async def check_video_eligibility(self, video_id: str, platform: str) -> Dict[str, Any]:
        """
        Checks whether a video can be processed for this brand right now.
        """
        url = f"{self.operator_url}/internal/automation-videos/check-eligibility"
        headers = {
            "x-internal-secret": self.internal_secret,
            "Content-Type": "application/json"
        }
        payload = {
            "brand_id": self.brand_id,
            "platform": platform,
            "video_id": video_id
        }

        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(url, json=payload, headers=headers, timeout=10.0)
                if resp.status_code == 200:
                    return resp.json()
                logger.error(f"Failed to check video eligibility {resp.status_code}: {resp.text}")
        except Exception as e:
            logger.error(f"Video eligibility exception: {e}")

        return {"eligible": True}

    async def emit_batch(self, events: List[Dict[str, Any]], run_id: str) -> tuple[int, int, List[str], Dict[str, int]]:
        """
        Emits a batch of events to Ingestion Service.
        
        Returns:
            (success_count: int, failed_count: int, error_classes: List[str], ingest_status_counts: Dict[str, int])
            - success_count: Number of successfully emitted events
            - failed_count: Number of failed emissions
            - error_classes: List of error classifications for failed emissions
        """
        success_count = 0
        failed_count = 0
        error_classes = []
        ingest_status_counts: Dict[str, int] = {}
        
        for event_data in events:
            success, error_class, ingest_status = await self.emit_event(event_data, run_id)
            if success:
                success_count += 1
                if ingest_status:
                    ingest_status_counts[ingest_status] = ingest_status_counts.get(ingest_status, 0) + 1
            else:
                failed_count += 1
                if error_class:
                    error_classes.append(error_class)
        
        return (success_count, failed_count, error_classes, ingest_status_counts)

    async def emit_event(self, data: Dict[str, Any], run_id: str) -> tuple[bool, str | None, str | None]:
        """
        Emits a single standardized event.
        Enforces Automation Context fields.
        
        Returns:
            (success: bool, error_class: str | None)
            - success: True if HTTP 2xx AND response indicates acceptance
            - error_class: Error classification if failed (HTTP_4XX, HTTP_5XX, NETWORK_ERROR, etc.)
        """
        url = f"{self.ingestion_url}/events"
        
        # Prepare Payload strictly conforming to DesktopCaptureEventSchema
        from datetime import datetime, timezone
        
        # Build valid URLs - ingestion requires proper URL format
        video_url = data.get("video_url") or data.get("page_url") or ""
        page_url = data.get("page_url") or video_url or ""
        
        # Ensure URLs are valid (ingestion rejects non-URL strings)
        if not page_url.startswith("http"):
            page_url = f"https://www.xiaohongshu.com/explore/{data.get('video_id', 'unknown')}"
        if not video_url.startswith("http"):
            video_url = page_url
        
        # Ingestion requires ISO datetime with Z suffix
        timestamp = data.get("page_timestamp") or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        
        payload = {
            "event_type": "DESKTOP_CAPTURE",
            "platform": data.get("platform", "tiktok"),
            "session": {
                "session_id": "00000000-0000-0000-0000-000000000000",
                "install_id": self.install_id,
                "brand_id": self.brand_id
            },
            "page": {
                "url": page_url,
                "page_type": "VIDEO",
                "timestamp": timestamp
            },
            "video": {
                "video_id": data.get("video_id", "unknown"),
                "video_url": video_url,
                "title": data.get("caption", ""),
                "author_id": data.get("video_author_id", "unknown"),
                "author_name": data.get("video_author_name", data.get("author", "unknown"))
            },
            "comment": {
                "comment_id": data.get("referral_comment_id", f"auto-{data.get('video_id', 'unknown')}"),
                "author_id": data.get("comment_author_id", "unknown"),
                "author_name": data.get("comment_author_name") or data.get("comment_author_id") or data.get("author", "unknown"),
                "text": data.get("content_text", ""),
                "reply_count": data.get("reply_count", 0) or 0,
                "like_count": data.get("like_count", 0) or 0
            },
            "context": {
                "source": "AUTOMATION",
                "automation_run_id": run_id,
                "visible": True,
                "position": "viewport",
                "user_action": "automation_capture"
            },
            "client_meta": {
                "extension_version": "0.0.1-automation",
                "browser": "playwright",
                "os": "linux" # Docker
            }
        }

        headers = {
            "x-install-id": self.install_id,
            "Content-Type": "application/json"
        }
        if self.install_secret:
            headers["x-install-secret"] = self.install_secret
        
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(url, json=payload, headers=headers, timeout=5.0)
                
                # P1-B: Emission success = HTTP 2xx AND response indicates acceptance
                if resp.status_code in (200, 201, 202):
                    try:
                        body = resp.json()
                        status = body.get("status")
                        if status in ("accepted", "success"):
                            logger.info(f"Event emitted: {body.get('event_id')} ({body.get('ingest_status')})")
                            return (True, None, body.get("ingest_status"))
                        else:
                            error_class = f"INGESTION_REJECTED_{status.upper() if status else 'UNKNOWN'}"
                            logger.error(f"Event rejected by ingestion: {status}")
                            return (False, error_class, None)
                    except Exception:
                        # 2xx but unparseable body - treat as success for leniency
                        logger.warning("Emission returned 2xx but unparseable body, treating as success")
                        return (True, None, None)
                        
                elif resp.status_code >= 500:
                    error_class = f"INGESTION_HTTP_{resp.status_code}"
                    logger.error(f"Event emission failed {resp.status_code}: {resp.text}")
                    return (False, error_class, None)
                    
                elif resp.status_code >= 400:
                    error_class = f"INGESTION_HTTP_{resp.status_code}"
                    logger.error(f"Event emission client error {resp.status_code}: {resp.text}")
                    return (False, error_class, None)
                    
                else:
                    error_class = f"INGESTION_HTTP_{resp.status_code}"
                    logger.error(f"Event emission unexpected status {resp.status_code}")
                    return (False, error_class, None)
                    
        except httpx.TimeoutException:
            logger.error("Event emission timeout")
            return (False, "INGESTION_TIMEOUT", None)
        except httpx.NetworkError as e:
            logger.error(f"Event emission network error: {e}")
            return (False, "INGESTION_NETWORK_ERROR", None)
        except Exception as e:
            logger.error(f"Event emission exception: {e}")
            return (False, "INGESTION_EXCEPTION", None)

    async def get_market_profiles(self) -> Dict[str, Any]:
        """
        Fetches Market Profiles for the brand.
        """
        url = f"{self.operator_url}/brands/{self.brand_id}/market-profiles"
        headers = {
            "x-install-id": self.install_id,
            "x-internal-secret": self.internal_secret,
            "Content-Type": "application/json"
        }
        
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(url, headers=headers, timeout=5.0)
                if resp.status_code == 200:
                    return resp.json()
                else:
                    logger.error(f"Failed to fetch profiles {resp.status_code}: {resp.text}")
                    return []
        except Exception as e:
            logger.error(f"Profile fetch exception: {e}")
            return []

    async def score_content(self, automation_run_id: str, text: str, hashtags: list, video_id: str = None, video_url: str = None) -> Dict[str, Any]:
        """
        WF-3.1: Calls AI Core Market Match Service with automation_run_id.
        Worker is AUTHORITATIVE for ERROR tagging - generates envelope from status_code.
        """
        url = f"{self.ai_core_url}/v1/market/score"
        payload = {
            "automation_run_id": automation_run_id,
            "text": text,
            "hashtags": hashtags,
            "video_id": video_id,
            "video_url": video_url
        }
        
        headers = {
            "X-Internal-Secret": self.internal_secret,
            "X-Correlation-ID": f"disco-{self.install_id}",
            "Content-Type": "application/json"
        }
        
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.post(url, json=payload, headers=headers)
                
                # WF-3.1: Fail-fast on auth failures (abort run immediately)
                if resp.status_code in (401, 403):
                    logger.error(f"WF-3.1 FATAL AUTH FAILURE: {resp.status_code} from AI-Core")
                    raise Exception(f"WF-3.1 FATAL: Auth failure in market scoring {resp.status_code}")
                
                # WF-3.1: Worker is authoritative - generate ERROR from status_code
                if resp.status_code != 200:
                    error_class = self._map_status_to_error_class(resp.status_code)
                    logger.error(f"AI-Core non-200: {resp.status_code}, mapped to {error_class}")
                    return {
                        "decision": "ERROR",
                        "score": None,
                        "evaluation_performed": False,
                        "error_class": error_class,
                        "http_status": resp.status_code,
                        "reasons": [{"type": "ERROR", "detail": f"AI-Core returned {resp.status_code}", "weight": None}],
                        "debug": {}
                    }
                
                # 200 response - validate contract
                try:
                    result = resp.json()
                    
                    # WF-3.1: Validate required fields
                    if "decision" not in result or "evaluation_performed" not in result:
                        logger.error(f"AI-Core CONTRACT violation: missing required fields")
                        return {
                            "decision": "ERROR",
                            "score": None,
                            "evaluation_performed": False,
                            "error_class": "AI_CORE_CONTRACT",
                            "http_status": 200,
                            "reasons": [{"type": "ERROR", "detail": "Malformed AI-Core response", "weight": None}],
                            "debug": {}
                        }
                    
                    return result
                    
                except (json.JSONDecodeError, ValueError) as e:
                    logger.error(f"AI-Core CONTRACT violation: invalid JSON - {e}")
                    return {
                        "decision": "ERROR",
                        "score": None,
                        "evaluation_performed": False,
                        "error_class": "AI_CORE_CONTRACT",
                        "http_status": 200,
                        "reasons": [{"type": "ERROR", "detail": "Invalid JSON response", "weight": None}],
                        "debug": {}
                    }
                    
        except httpx.TimeoutException as e:
            logger.error(f"AI-Core TIMEOUT: {e}")
            return {
                "decision": "ERROR",
                "score": None,
                "evaluation_performed": False,
                "error_class": "AI_CORE_TIMEOUT",
                "http_status": None,
                "reasons": [{"type": "ERROR", "detail": f"Timeout: {str(e)}", "weight": None}],
                "debug": {}
            }
        except httpx.HTTPError as e:
            logger.error(f"AI-Core HTTP ERROR: {e}")
            return {
                "decision": "ERROR",
                "score": None,
                "evaluation_performed": False,
                "error_class": "AI_CORE_HTTP_ERROR",
                "http_status": None,
                "reasons": [{"type": "ERROR", "detail": f"Network error: {str(e)}", "weight": None}],
                "debug": {}
            }
    
    def _map_status_to_error_class(self, status_code: int) -> str:
        """WF-3.1: Map HTTP status codes to stable error machine tags."""
        if status_code == 404:
            return "AI_CORE_HTTP_404"
        elif status_code == 409:
            return "AI_CORE_HTTP_409"
        elif status_code == 422:
            return "AI_CORE_HTTP_422"
        elif status_code >= 500:
            return "AI_CORE_HTTP_500"
        elif status_code >= 400:
            return "AI_CORE_HTTP_4XX"
        else:
            return f"AI_CORE_HTTP_{status_code}"

    async def update_run_internal(
        self,
        run_id: str,
        status: str,
        abort_reason: str | None = None,
        claim_token: str | None = None,
        next_retry_at: str | None = None
    ):
        """
        P1-B.1: Update automation run status via Operator API.
        Uses PATCH /internal/automation-run/:runId/status (WF-3.1 endpoint)
        """
        url = f"{self.operator_url}/internal/automation-run/{run_id}/status"
        payload = {"status": status}
        if abort_reason:
            payload["abort_reason"] = abort_reason
        effective_claim_token = claim_token or self.claim_token
        if effective_claim_token:
            payload["claim_token"] = effective_claim_token
            payload["worker_id"] = self.install_id
        if next_retry_at:
            payload["next_retry_at"] = next_retry_at
        
        # P1-B.1: Use PATCH, not POST
        headers = {"X-Internal-Secret": self.internal_secret, "Content-Type": "application/json"}
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.patch(url, json=payload, headers=headers, timeout=10.0)
                if resp.status_code not in (200, 204):
                    logger.error(f"P1-B.1: Failed to update run status: {resp.status_code} {resp.text}")
                else:
                    logger.info(f"P1-B.1: Run {run_id} status updated to {status}")
        except Exception as e:
            logger.error(f"P1-B.1: Exception updating run status: {e}")
    
    async def update_run_stats(self, run_id: str, brand_id: str, stats: dict):
        """
        Update automation run execution stats (videos, comments, emissions).
        Called from finalize_run to persist counted outcomes.
        """
        url = f"{self.operator_url}/brands/{brand_id}/automation-runs/{run_id}"
        payload = {"stats": stats}
        
        # FIX: Use x-install-id header (requireAgentAccess expects this, not internal secret)
        headers = {"x-install-id": self.install_id, "Content-Type": "application/json"}
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.put(url, json=payload, headers=headers, timeout=10.0)
                if resp.status_code not in (200, 204):
                    logger.error(f"Failed to update run stats: {resp.status_code} {resp.text}")
                else:
                    logger.info(f"Run {run_id} stats updated: {stats}")
        except Exception as e:
            logger.error(f"Exception updating run stats: {e}")
