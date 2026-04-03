from typing import Dict, Optional, Any
import datetime

from .schemas import (
    DeliveryConfig, DeliveryResult, DeliveryStatus, DeliveryAudit, ConnectorType
)
from .connectors import BaseConnector, MockConnector
from ..generation.schemas import GenerationMode

class DeliveryEngine:
    """
    Phase 9: Reliable Delivery.
    Handles Idempotency, Retries, and Platform Dispatch.
    """
    def __init__(self, config: DeliveryConfig):
        self.config = config
        self.connectors: Dict[str, BaseConnector] = {}
        self._init_connectors()
        # Mock Idempotency Store (Key -> Result)
        self.idempotency_store: Dict[str, DeliveryResult] = {}

    def _init_connectors(self):
        for platform, type_ in self.config.active_connectors.items():
            if type_ == ConnectorType.MOCK:
                self.connectors[platform] = MockConnector()
            # Add real connectors here

    def process(self,
                platform: str,
                mode: GenerationMode,
                message_text: str,
                comment_id: str,
                video_id: str,
                author_id: str,
                idempotency_key: str) -> DeliveryResult:
        
        audit = DeliveryAudit(platform=platform)
        
        # --- Audit E: Kill Switches ---
        if self.config.kill_switch_global:
             return self._create_result(DeliveryStatus.FAILED, ["kill_switch:global"], audit)
        
        if platform in self.config.kill_switch_platforms:
             return self._create_result(DeliveryStatus.FAILED, [f"kill_switch:platform:{platform}"], audit)

        # --- Gate 1: Empty Message ---
        if not message_text:
            return self._create_result(DeliveryStatus.FAILED, ["empty_message_blocked"], audit)

        # --- Gate 2: Idempotency ---
        if idempotency_key in self.idempotency_store:
            cached = self.idempotency_store[idempotency_key]
            # Verify cached result is success before returning? usually strict idempotency returns cached success.
            # If cached failure, we might allow retry? 
            # Prompt says: "If same key was already sent successfully: return previous success".
            if cached.delivery_status == DeliveryStatus.SENT:
                cached.reason_codes.append("idempotent_replay")
                return cached
        
        # --- Audit B: Dry Run ---
        if self.config.dry_run_enabled:
             # Simulate Success but do NOT call connector
             # Store idempotency for Dry Run? Yes, to test that logic.
             res = self._create_result(DeliveryStatus.SKIPPED_DRY_RUN, ["dry_run"], audit)
             self.idempotency_store[idempotency_key] = res
             return res

        # --- Gate 3: Connector Availability ---
        connector = self.connectors.get(platform)
        if not connector:
             return self._create_result(DeliveryStatus.FAILED, ["connector_not_found"], audit)

        # --- Delivery Loop (Retry Logic) ---
        attempts = 0
        last_error = ""
        
        while attempts <= self.config.retry_max_attempts:
            attempts += 1
            try:
                resp = None
                if mode == GenerationMode.REPLY:
                    resp = connector.send_reply(message_text, comment_id, video_id)
                elif mode == GenerationMode.DM:
                    resp = connector.send_dm(message_text, author_id)
                
                # Success
                res = self._create_result(
                    DeliveryStatus.SENT, 
                    [], 
                    audit, 
                    msg_id=resp.get("id"),
                    attempts=attempts
                )
                res.audit.delivered_at = datetime.datetime.now()
                # Store success
                self.idempotency_store[idempotency_key] = res
                return res

            except Exception as e:
                last_error = str(e)
                # Classify Error
                if "429" in last_error or "Network" in last_error:
                    # Transient -> Retry
                    if attempts <= self.config.retry_max_attempts:
                        # Exponential Backoff (Mocked by just continue/sleep)
                        continue 
                    else:
                        return self._create_result(
                            DeliveryStatus.FAILED, 
                            ["max_retries_exceeded", f"error:{last_error}"], 
                            audit, 
                            attempts=attempts
                        )
                else:
                    # Permanent -> Fail
                    return self._create_result(
                         DeliveryStatus.FAILED, 
                         ["permanent_error", f"error:{last_error}"], 
                         audit, 
                         attempts=attempts
                    )
        
        return self._create_result(DeliveryStatus.FAILED, ["unknown_error"], audit)

    def _create_result(self, status: DeliveryStatus, reasons: list, audit: DeliveryAudit, msg_id: str=None, attempts: int=0) -> DeliveryResult:
        audit.attempt_count = attempts
        return DeliveryResult(
            delivery_status=status,
            platform_message_id=msg_id,
            attempt_count=attempts,
            reason_codes=reasons,
            audit=audit
        )
