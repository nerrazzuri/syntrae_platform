from typing import List, Optional
from .schemas import EngagementDecision, DecisionType, EnforcementDecision, Constraints
from ..safety.schemas import SafetyDecision, SafetyDecisionType, RiskLevel
from ..rag.schemas import ResponsePlan

class EnforcementEngine:
    """
    Phase 7b: Enforcement Engine (Audit Compliance Layer).
    Aggregates Policy (P6), Safety (P7), and Plan (P5) into a single authoritative EnforcementDecision.
    Audit Requirement A1: Single Object.
    Audit Requirement A2: Completeness (includes decision, risk, knowledge_refs, constraints).
    Audit Requirement A3: Determinism (Pure function of inputs).
    """

    def process(self, 
                policy: EngagementDecision, 
                safety: SafetyDecision, 
                plan: ResponsePlan) -> EnforcementDecision:
        
        reasons = []
        final_decision = DecisionType.DENY
        engagement_type = "ignore"
        risk_level = str(safety.risk_level.value)
        allowed_refs: List[str] = []
        
        # --- Logic Aggregation ---
        
        # 1. Safety Check (Highest Priority)
        if safety.final_decision == SafetyDecisionType.BLOCK:
            final_decision = DecisionType.DENY
            reasons.append(f"safety:blocked:{safety.reason_codes[0] if safety.reason_codes else 'unknown'}")
        elif safety.final_decision == SafetyDecisionType.DEFER:
            final_decision = DecisionType.DEFER
            reasons.append("safety:defer")
        else:
            # Safety ALLOWed, check Policy
            if policy.decision == DecisionType.DENY:
                final_decision = DecisionType.DENY
                reasons.extend(policy.reason_codes)
            elif policy.decision == DecisionType.DEFER:
                final_decision = DecisionType.DEFER
                reasons.extend(policy.reason_codes)
            else:
                # Both ALLOW
                final_decision = policy.decision
                if final_decision == DecisionType.ALLOW_REPLY:
                    engagement_type = "reply"
                elif final_decision == DecisionType.ALLOW_DM:
                    engagement_type = "dm"
                
                reasons.append("enforcement:approved")
                
                # Knowledge Refs (Audit A2/B2)
                if plan.candidates:
                    allowed_refs = plan.candidates[0].knowledge_refs
        
        # Constraints (from Policy)
        # Ensure non-null values (Audit A2)
        # Map allowed_actions to constraints since they are merged in EnforcementDecision
        cons = policy.constraints
        cons.can_include_url = policy.allowed_actions.can_include_url
        cons.can_include_price = policy.allowed_actions.can_include_price
        
        return EnforcementDecision(
            decision=final_decision,
            engagement_type=engagement_type,
            risk_level=risk_level,
            allowed_knowledge_refs=allowed_refs if final_decision in [DecisionType.ALLOW_REPLY, DecisionType.ALLOW_DM] else [],
            constraints=cons,
            reason_codes=reasons,
            audit_trace={
                "policy_version": policy.audit.policy_version,
                "risk_version": safety.audit.risk_policy_version
            }
        )
