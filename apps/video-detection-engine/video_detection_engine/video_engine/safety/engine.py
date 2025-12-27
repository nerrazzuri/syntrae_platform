from typing import List, Dict, Optional
import datetime

from .schemas import (
    SafetyDecision, SafetyConfig, RiskSignals,
    SafetyDecisionType, RiskLevel, AppliedLimits, SafetyCooldown, SafetyAudit
)

from ..policy.schemas import EngagementDecision, DecisionType

class RiskScoringEngine:
    """
    Phase 7: Rate Limiting & Risk Scoring.
    Final gate before generation.
    """
    
    def __init__(self, config: SafetyConfig):
        self.config = config
        # Mock Rate Store
        self.limits_store = {
            "author": {}, 
            "video": {},
            "tenant": 0,
            "burst": 0
        }
    
    def process(self, 
                policy_decision: EngagementDecision,
                author_id: str,
                video_id: str,
                risk_signals: RiskSignals) -> SafetyDecision:
        try:
            return self._unsafe_process(policy_decision, author_id, video_id, risk_signals)
        except Exception as e:
            return self._fail_closed_decision(str(e))

    def _unsafe_process(self, 
                       policy_decision: EngagementDecision,
                       author_id: str,
                       video_id: str,
                       risk_signals: RiskSignals) -> SafetyDecision:
        
        # --- Step 1: Respect Phase 6 ---
        if policy_decision.decision == DecisionType.DENY:
            return self._create_decision(SafetyDecisionType.BLOCK, 0.0, RiskLevel.LOW, ["phase6:deny"])
            
        if policy_decision.decision == DecisionType.DEFER:
            return self._create_decision(SafetyDecisionType.DEFER, 0.0, RiskLevel.LOW, ["phase6:defer"], cooldown=SafetyCooldown(author_seconds=policy_decision.cooldown.author_seconds))

        # --- Step 2: Compute Risk Score ---
        # Conceptual Formula
        # score = w1 * signals.duplicate_rate + w2 * dummy
        score = (
            self.config.weight_author_velocity * risk_signals.duplicate_comment_rate +
            self.config.weight_dummy_factor * 0.1 # Baseline
        )
        score = min(max(score, 0.0), 1.0) # Clamp
        
        risk_level = RiskLevel.LOW
        if score >= self.config.risk_threshold_high:
            risk_level = RiskLevel.HIGH
        elif score >= self.config.risk_threshold_low:
            risk_level = RiskLevel.MEDIUM
            
        # --- Step 3: Apply Thresholds ---
        decision_type = SafetyDecisionType.ALLOW
        reasons = []
        
        if risk_level == RiskLevel.HIGH:
            decision_type = SafetyDecisionType.BLOCK
            reasons.append("risk:threshold_high")
        elif risk_level == RiskLevel.MEDIUM:
            decision_type = SafetyDecisionType.DEFER
            reasons.append("risk:threshold_medium")
            
        # --- Step 4: Enforce Limits (Mock) ---
        applied = AppliedLimits()
        cooldown = SafetyCooldown()
        
        # Author Limit
        author_count = self.limits_store["author"].get(author_id, 0)
        if author_count >= self.config.limit_author_max:
             decision_type = SafetyDecisionType.DEFER
             applied.author_rate = True
             cooldown.author_seconds = 300
             reasons.append("limit:author")
             
        # Video Limit
        video_count = self.limits_store["video"].get(video_id, 0)
        if video_count >= self.config.limit_video_max:
             decision_type = SafetyDecisionType.DEFER
             applied.video_rate = True
             cooldown.video_seconds = 600
             reasons.append("limit:video")
             
        # Tenant Limit
        if self.limits_store["tenant"] >= self.config.limit_tenant_max:
             decision_type = SafetyDecisionType.DEFER
             applied.tenant_rate = True
             cooldown.tenant_seconds = 60
             reasons.append("limit:tenant")
             
        if decision_type == SafetyDecisionType.ALLOW:
            reasons.append("risk:safe")
            # Update counters
            self.limits_store["author"][author_id] = author_count + 1
            self.limits_store["video"][video_id] = video_count + 1
            self.limits_store["tenant"] += 1

        return SafetyDecision(
            final_decision=decision_type,
            risk_score=score,
            risk_level=risk_level,
            applied_limits=applied,
            cooldown=cooldown,
            reason_codes=reasons,
            audit=SafetyAudit(risk_policy_version=self.config.risk_policy_version)
        )

    def _create_decision(self, decision: SafetyDecisionType, score: float, level: RiskLevel, reasons: List[str], cooldown: SafetyCooldown = None) -> SafetyDecision:
        return SafetyDecision(
            final_decision=decision,
            risk_score=score,
            risk_level=level,
            applied_limits=AppliedLimits(),
            cooldown=cooldown or SafetyCooldown(),
            reason_codes=reasons,
            audit=SafetyAudit(risk_policy_version=self.config.risk_policy_version)
        )

    def _fail_closed_decision(self, error: str) -> SafetyDecision:
        return SafetyDecision(
            final_decision=SafetyDecisionType.BLOCK,
            risk_score=1.0, # High risk on error
            risk_level=RiskLevel.HIGH,
            applied_limits=AppliedLimits(),
            cooldown=SafetyCooldown(),
            reason_codes=["error:risk_engine", error],
            audit=SafetyAudit(risk_policy_version=self.config.risk_policy_version)
        )
