import pytest
from unittest.mock import MagicMock
import hashlib
from video_engine.orchestrator.schemas import (
    EngagementEvent, OrchestrationResult, OrchestrationStatus, DeliveryMode, VideoContext,
    EngagementDecisionType
)
from video_engine.orchestrator.engine import EngagementOrchestrator
from video_engine.intent.schemas import IntentResult, IntentType
from video_engine.rag_gateway.schemas import RetrieveResponse, GovernanceMetadata as DocumentMetadata, SearchResult as DocumentResult
# from video_engine.rag_gateway.service import RAGGatewayService (Not needed if mocked via RAGResponseEngine mock?)
from video_engine.rag.engine import RAGResponseEngine
from video_engine.rag.schemas import ResponsePlan, ResponseCandidate, ResponseType
from video_engine.policy.schemas import EngagementDecision, DecisionType, AllowedActions, Constraints, Cooldown, AuditInfo
from video_engine.safety.schemas import SafetyDecision, SafetyDecisionType, RiskLevel, AppliedLimits, SafetyCooldown, SafetyAudit
from video_engine.policy.schemas import EnforcementDecision
from video_engine.generation.schemas import MessageResult, MessageAudit, GenerationMode
from video_engine.delivery.schemas import DeliveryResult, DeliveryStatus, DeliveryAudit
from video_engine.core.schemas import DetectionResult, SignalTrace

@pytest.fixture
def mock_engines():
    return {
        "intent": MagicMock(),
        "knowledge": MagicMock(), # Phase 5 Engine
        "policy": MagicMock(),
        "safety": MagicMock(),
        "enforcement": MagicMock(),
        "generation": MagicMock(),
        "delivery": MagicMock()
    }

@pytest.fixture
def orchestrator(mock_engines):
    # Ensure delivery engine has config
    mock_engines["delivery"].config = MagicMock()
    mock_engines["delivery"].config.dry_run_enabled = False
    
    return EngagementOrchestrator(
        mock_engines["intent"],
        mock_engines["knowledge"], # Phase 5
        mock_engines["policy"],
        mock_engines["safety"],
        mock_engines["enforcement"],
        mock_engines["generation"],
        mock_engines["delivery"]
    )

@pytest.fixture
def detection_data():
    return DetectionResult(
        is_commercial_content=True,
        commercial_confidence=1.0,
        niche="beauty.makeup",
        sub_niche="general",
        content_type="demo",
        confidence=0.9,
        signals_used=SignalTrace()
    )

@pytest.fixture
def event(detection_data):
    return EngagementEvent(
        trace_id="trace-1",
        tenant_id="t1",
        platform="tiktok",
        video_id="v1",
        comment_id="c1",
        comment_text="how much?",
        comment_author_id="a1",
        video_context=VideoContext(creator_id="u1", video_caption="Cap"),
        delivery_mode=DeliveryMode.DRY_RUN,
        detection=detection_data, 
        rag_access_token="mock_jwt_t1_phaseX_rag.retrieve" 
    )

# ... Helper to setup common mocks ...
def setup_success_mocks(mock_engines, engagement_type="reply"):
    mock_engines["intent"].process.return_value = IntentResult(
        comment_id="c1",
        intent_type=IntentType.INQUIRY, 
        intent_confidence=0.9, 
        is_actionable=True,
        related_niche="beauty.makeup",
        signals_used={"text": ["kw:price"]}
    )
    # Phase 5 Process Mock
    mock_engines["knowledge"].process.return_value = ResponsePlan(
        candidates=[ResponseCandidate(response_type=ResponseType.PRODUCT_INFO, confidence=0.9)],
        selected_language="en"
    )
    
    mock_engines["policy"].process.return_value = EngagementDecision(decision=DecisionType.ALLOW_REPLY, decision_confidence=1.0, allowed_actions=AllowedActions(), cooldown=Cooldown(), constraints=Constraints(), audit=AuditInfo())
    mock_engines["safety"].process.return_value = SafetyDecision(final_decision=SafetyDecisionType.ALLOW, risk_level=RiskLevel.LOW, risk_score=0.1, applied_limits=AppliedLimits(), cooldown=SafetyCooldown(), audit=SafetyAudit())
    
    # Control Engagement Type
    mock_engines["enforcement"].process.return_value = EnforcementDecision(
        decision=DecisionType.ALLOW_REPLY, 
        engagement_type=engagement_type, # Controlled here
        risk_level="low", 
        constraints=Constraints()
    )
    
    mock_engines["generation"].process.return_value = MessageResult(message_text="Reply", message_language="en", audit=MessageAudit())
    mock_engines["delivery"].process.return_value = DeliveryResult(delivery_status=DeliveryStatus.SKIPPED_DRY_RUN, audit=DeliveryAudit(platform="tiktok"))


def test_p10_01_success_flow(orchestrator, mock_engines, event):
    setup_success_mocks(mock_engines, "reply")
    res = orchestrator.process_event(event)
    assert res.final_status == OrchestrationStatus.COMPLETED
    assert res.decision == EngagementDecisionType.ENGAGE
    assert len(res.phase_history) == 6

def test_p10_02_intent_skip_flow(orchestrator, mock_engines, event):
    mock_engines["intent"].process.return_value = IntentResult(
        comment_id="c1",
        intent_type=IntentType.UNKNOWN, 
        intent_confidence=0.9, 
        is_actionable=False,
        related_niche="beauty.makeup",
        signals_used={}
    )
    res = orchestrator.process_event(event)
    assert res.final_status == OrchestrationStatus.SKIPPED
    assert res.decision == EngagementDecisionType.SKIP

def test_p10_03_enforcement_block_flow(orchestrator, mock_engines, event):
    mock_engines["intent"].process.return_value = IntentResult(
        comment_id="c1", intent_type=IntentType.INQUIRY, intent_confidence=0.9, is_actionable=True, related_niche="beauty", signals_used={}
    )
    # Mock Empty Plan
    mock_engines["knowledge"].process.return_value = ResponsePlan(candidates=[], selected_language="en")
    
    mock_engines["policy"].process.return_value = EngagementDecision(decision=DecisionType.DENY, decision_confidence=1.0, allowed_actions=AllowedActions(), cooldown=Cooldown(), constraints=Constraints(), audit=AuditInfo())
    mock_engines["safety"].process.return_value = SafetyDecision(final_decision=SafetyDecisionType.ALLOW, risk_level=RiskLevel.LOW, risk_score=0.1, applied_limits=AppliedLimits(), cooldown=SafetyCooldown(), audit=SafetyAudit())
    mock_engines["enforcement"].process.return_value = EnforcementDecision(decision=DecisionType.DENY, engagement_type="ignore", risk_level="low", constraints=Constraints())
    
    res = orchestrator.process_event(event)
    assert res.final_status == OrchestrationStatus.BLOCKED
    assert res.decision == EngagementDecisionType.BLOCK

def test_p10_04_generation_fail(orchestrator, mock_engines, event):
    setup_success_mocks(mock_engines, "reply")
    mock_engines["generation"].process.return_value = MessageResult(message_text="", message_language="en", safety_flags=["failed"], audit=MessageAudit()) # Empty text
    res = orchestrator.process_event(event)
    assert res.final_status == OrchestrationStatus.FAILED

def test_p10_05_delivery_override(orchestrator, mock_engines, event):
    event.delivery_mode = DeliveryMode.DRY_RUN
    setup_success_mocks(mock_engines, "reply")
    orchestrator.process_event(event)
    mock_engines["delivery"].process.assert_called()

def test_p10_06_crash_handling(orchestrator, mock_engines, event):
    mock_engines["intent"].process.side_effect = Exception("Boom")
    res = orchestrator.process_event(event)
    assert res.final_status == OrchestrationStatus.FAILED

def test_p10_07_idempotency_dm(orchestrator, mock_engines, event):
    setup_success_mocks(mock_engines, "dm")
    res = orchestrator.process_event(event)
    assert res.final_status == OrchestrationStatus.COMPLETED
    
    trace_id = "trace-1"
    platform = "tiktok"
    channel = "DM" # mapped from 'dm'
    recipient = "a1" # author_id
    raw = f"{trace_id}:{platform}:{channel}:{recipient}"
    expected_key = hashlib.sha256(raw.encode()).hexdigest()
    
    args, _ = mock_engines["delivery"].process.call_args
    assert args[6] == expected_key

def test_p10_08_idempotency_reply(orchestrator, mock_engines, event):
    setup_success_mocks(mock_engines, "reply")
    res = orchestrator.process_event(event)
    assert res.final_status == OrchestrationStatus.COMPLETED
    
    trace_id = "trace-1"
    platform = "tiktok"
    channel = "COMMENT_REPLY"
    recipient = "c1" # comment_id
    raw = f"{trace_id}:{platform}:{channel}:{recipient}"
    expected_key = hashlib.sha256(raw.encode()).hexdigest()
    
    args, _ = mock_engines["delivery"].process.call_args
    assert args[6] == expected_key

def test_p10_09_missing_recipient_fail(orchestrator, mock_engines, event):
    event.comment_author_id = ""
    setup_success_mocks(mock_engines, "dm")
    res = orchestrator.process_event(event)
    assert res.final_status == OrchestrationStatus.FAILED
    assert "Missing Required Field" in res.phase_history[-1].error
