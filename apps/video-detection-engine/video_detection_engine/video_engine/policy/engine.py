from typing import List, Optional, Dict
import datetime

from .schemas import (
    EngagementDecision, EngagementConfig, PlatformPolicyProfile,
    DecisionType, AllowedActions, Cooldown, Constraints, AuditInfo
)
from ..core.schemas import DetectionResult
from ..intent.schemas import IntentResult, IntentType, CommentData
from ..rag.schemas import ResponsePlan

class EngagementPolicyEngine:
    """
    Phase 6: Authoritative decision engine for engagement.
    
    Gates:
    1. Eligibility (Hard Fail if non-commercial/non-actionable)
    2. Risk (Hard Fail if spam/bot)
    3. Platform Rules (Capabilities)
    4. Rate Limits (Defer/Deny)
    """
    
    def __init__(self, tenant_config: EngagementConfig, platform_profile: PlatformPolicyProfile):
        self.config = tenant_config
        self.platform = platform_profile
        
        # Mock Rate Limit Store (In real life: Redis)
        self.rate_store = {
            "author": {}, # author_id -> timestamp[]
            "video": {},  # video_id -> count
            "tenant": 0   # count
        }
        
    def process(self, 
                comment: CommentData, 
                detection: DetectionResult, 
                intent: IntentResult, 
                plan: ResponsePlan,
                author_id: str,
                video_id: str) -> EngagementDecision:
        
        try:
            return self._unsafe_process(comment, detection, intent, plan, author_id, video_id)
        except Exception as e:
            # Fail Closed
            return self._deny_decision("error:policy_engine", str(e))

    def _unsafe_process(self, 
                       comment: CommentData, 
                       detection: DetectionResult, 
                       intent: IntentResult, 
                       plan: ResponsePlan,
                       author_id: str,
                       video_id: str) -> EngagementDecision:
        
        reasons = []
        
        # --- Gate 1: Eligibility Gate ---
        if not detection.is_commercial_content:
            return self._deny_decision("gate:non_commercial")
            
        if not intent.is_actionable:
            return self._deny_decision("gate:non_actionable")
            
        if not plan.candidates:
            return self._deny_decision("gate:no_response_plan")
            
        # --- Gate 2: Risk Gate ---
        if intent.intent_type == IntentType.SPAM:
             return self._deny_decision("risk:spam_intent")
             
        # Feature: Check author risk (Mock)
        if author_id.startswith("bot_"):
            return self._deny_decision("risk:author_bot")
            
        # --- Gate 3: Platform Capability Gate ---
        # Logic is implicit: if we select Allow DM but platform can't DM, we switch to Reply or Deny.
        # Implemented in Decision Selection step.
        
        # --- Gate 4: Rate Limit & Cooldown Gate ---
        # Mock Logic: Check mock store
        # Author Limit
        author_count = self.rate_store["author"].get(author_id, 0)
        if author_count >= self.config.rate_limit_author_max:
             return self._defer_decision("limit:author_exceeded", 3600)
             
        # Video Limit
        video_count = self.rate_store["video"].get(video_id, 0)
        if video_count >= self.config.rate_limit_video_max:
             return self._defer_decision("limit:video_exceeded", 3600)

        # --- Engagement Mode Selection ---
        decision_type = DecisionType.DENY
        allowed = AllowedActions()
        
        # Default Strategy
        if intent.intent_type == IntentType.PURCHASE:
            # Purchase -> Reply preferred, DM if allowed & platform supports
            if self.config.allow_reply and self.platform.can_reply:
                decision_type = DecisionType.ALLOW_REPLY
                allowed.can_reply = True
            elif self.config.allow_dm and self.platform.can_dm:
                decision_type = DecisionType.ALLOW_DM
                allowed.can_dm = True
            else:
                 return self._deny_decision("gate:platform_policy_mismatch")
                 
        elif intent.intent_type in [IntentType.INQUIRY, IntentType.OBJECTION, IntentType.COMPARISON]:
             # Public reply preferred for transparency
            if self.config.allow_reply and self.platform.can_reply:
                decision_type = DecisionType.ALLOW_REPLY
                allowed.can_reply = True
            else:
                 return self._deny_decision("gate:platform_policy_mismatch")
        
        # If still Deny?
        if decision_type == DecisionType.DENY:
             return self._deny_decision("policy:no_valid_channel")

        # --- URL / Price Permissions ---
        if self.config.allow_urls and self.platform.can_url:
            allowed.can_include_url = True
            
        if self.config.allow_prices and self.platform.can_price:
            allowed.can_include_price = True

        # --- Constraints ---
        constraints = Constraints(
            max_message_length=self.platform.max_len,
            tone="neutral", # Default
            language=plan.selected_language,
            no_marketing_claims=True
        )
        
        # Mock: Increment Counters
        self.rate_store["author"][author_id] = author_count + 1
        self.rate_store["video"][video_id] = video_count + 1

        return EngagementDecision(
            decision=decision_type,
            decision_confidence=1.0,
            allowed_actions=allowed,
            cooldown=Cooldown(),
            constraints=constraints,
            reason_codes=["policy:approved"],
            audit=AuditInfo(
                policy_version=self.config.policy_version,
                applied_thresholds={}
            )
        )

    def _deny_decision(self, reason: str, details: str = "") -> EngagementDecision:
        return EngagementDecision(
            decision=DecisionType.DENY,
            decision_confidence=1.0,
            allowed_actions=AllowedActions(),
            cooldown=Cooldown(),
            constraints=Constraints(),
            reason_codes=[reason, details] if details else [reason],
            audit=AuditInfo(policy_version=self.config.policy_version)
        )

    def _defer_decision(self, reason: str, seconds: int) -> EngagementDecision:
        return EngagementDecision(
            decision=DecisionType.DEFER,
            decision_confidence=1.0,
            allowed_actions=AllowedActions(),
            cooldown=Cooldown(author_seconds=seconds),
            constraints=Constraints(),
            reason_codes=[reason],
            audit=AuditInfo(policy_version=self.config.policy_version)
        )
