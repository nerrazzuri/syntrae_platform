import datetime
from unittest.mock import MagicMock
from video_engine.orchestrator.schemas import EngagementEvent, VideoContext, DeliveryMode
from video_engine.orchestrator.engine import EngagementOrchestrator
from video_engine.intent.schemas import IntentResult, IntentType
from video_engine.rag_gateway.schemas import RetrieveResponse, GovernanceMetadata, SearchResult
from video_engine.policy.schemas import EngagementDecision, DecisionType, AllowedActions, Constraints, Cooldown, AuditInfo
from video_engine.safety.schemas import SafetyDecision, SafetyDecisionType, RiskLevel, AppliedLimits, SafetyCooldown, SafetyAudit
from video_engine.policy.schemas import EnforcementDecision
from video_engine.generation.schemas import MessageResult, MessageAudit
from video_engine.delivery.schemas import DeliveryResult, DeliveryStatus, DeliveryAudit

def run_debug():
    mock_engines = {
        "intent": MagicMock(),
        "rag": MagicMock(),
        "policy": MagicMock(),
        "safety": MagicMock(),
        "enforcement": MagicMock(),
        "generation": MagicMock(),
        "delivery": MagicMock()
    }
    
    # Config
    mock_engines["delivery"].config = MagicMock()
    mock_engines["delivery"].config.dry_run_enabled = False
    
    orch = EngagementOrchestrator(
        mock_engines["intent"],
        mock_engines["rag"],
        mock_engines["policy"],
        mock_engines["safety"],
        mock_engines["enforcement"],
        mock_engines["generation"],
        mock_engines["delivery"]
    )
    
    event = EngagementEvent(
        trace_id="trace-1",
        tenant_id="t1",
        platform="tiktok",
        video_id="v1",
        comment_id="c1",
        comment_text="how much?",
        comment_author_id="a1",
        video_context=VideoContext(creator_id="u1", video_caption="Cap"),
        delivery_mode=DeliveryMode.DRY_RUN
    )
    
    # Happy Path Setup
    mock_engines["intent"].process.return_value = IntentResult(
        comment_id="c1",
        intent_type=IntentType.INQUIRY, 
        intent_confidence=0.9, 
        is_actionable=True,
        related_niche="beauty.makeup",
        signals_used={"text": ["kw:price"]}
    )
    mock_engines["rag"].process_retrieve.return_value = RetrieveResponse(results=[
        SearchResult(doc_id="d1", version="v1", score=0.9, metadata=GovernanceMetadata(source="s"))
    ])
    mock_engines["policy"].process.return_value = EngagementDecision(
        decision=DecisionType.ALLOW_REPLY, 
        decision_confidence=1.0, 
        allowed_actions=AllowedActions(), 
        cooldown=Cooldown(), 
        constraints=Constraints(), 
        audit=AuditInfo()
    )
    mock_engines["safety"].process.return_value = SafetyDecision(
        final_decision=SafetyDecisionType.ALLOW, 
        risk_level=RiskLevel.LOW, 
        risk_score=0.1, 
        applied_limits=AppliedLimits(), 
        cooldown=SafetyCooldown(), 
        audit=SafetyAudit()
    )
    mock_engines["enforcement"].process.return_value = EnforcementDecision(
        decision=DecisionType.ALLOW_REPLY, 
        engagement_type="reply", 
        risk_level="low", 
        constraints=Constraints()
    )
    mock_engines["generation"].process.return_value = MessageResult(
        message_text="Reply", 
        message_language="en", 
        audit=MessageAudit()
    )
    mock_engines["delivery"].process.return_value = DeliveryResult(
        delivery_status=DeliveryStatus.SKIPPED_DRY_RUN, 
        audit=DeliveryAudit(platform="tiktok")
    )
    
    res = orch.process_event(event)
    
    print(f"Final Status: {res.final_status}")
    if res.final_status == "failed":
        print(f"Error in Last Phase: {res.phase_history[-1].error}")
        print(f"Phase Name: {res.phase_history[-1].phase_name}")

if __name__ == "__main__":
    run_debug()
