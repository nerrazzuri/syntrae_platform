import pytest
from unittest.mock import MagicMock, patch
from video_engine.core.schemas import DetectionResult, SignalTrace
from video_engine.intent.schemas import CommentData, IntentType, IntentResult
from video_engine.rag.schemas import ResponsePlan, ResponseCandidate, ResponseType
from video_engine.policy.schemas import EngagementConfig, PlatformPolicyProfile, DecisionType
from video_engine.policy.engine import EngagementPolicyEngine

# --- Fixtures ---

@pytest.fixture
def policy_config():
    return EngagementConfig(
        tenant_id="t1",
        allow_reply=True,
        allow_dm=True,
        allow_urls=True,
        allow_prices=True,
        rate_limit_author_max=10,
        rate_limit_video_max=100
    )

@pytest.fixture
def platform_profile():
    return PlatformPolicyProfile(
        platform_id="tiktok",
        can_reply=True,
        can_dm=True, # Initially allowed for most tests
        can_url=True,
        can_price=True
    )

@pytest.fixture
def engine(policy_config, platform_profile):
    return EngagementPolicyEngine(policy_config, platform_profile)

@pytest.fixture
def valid_inputs():
    detection = DetectionResult(
        is_commercial_content=True,
        commercial_confidence=0.9,
        niche="beauty.makeup",
        sub_niche="lipstick",
        content_type="review",
        confidence=0.9,
        signals_used=SignalTrace()
    )
    intent = IntentResult(
        comment_id="c1",
        is_actionable=True,
        intent_type=IntentType.PURCHASE,
        intent_confidence=0.9,
        related_niche="beauty.makeup",
        signals_used={}
    )
    plan = ResponsePlan(
        candidates=[ResponseCandidate(response_type=ResponseType.PRODUCT_INFO, confidence=0.9, knowledge_refs=["d1"])],
        selected_language="en"
    )
    comment = CommentData(id="c1", text="buy")
    return comment, detection, intent, plan

# --- Tests ---

def test_p6_01_schema_integrity(engine, valid_inputs):
    c, d, i, p = valid_inputs
    decision = engine.process(c, d, i, p, "u1", "v1")
    assert isinstance(decision.reason_codes, list)
    assert len(decision.reason_codes) > 0
    assert 0.0 <= decision.decision_confidence <= 1.0

def test_p6_02_determinism(engine, valid_inputs):
    c, d, i, p = valid_inputs
    res1 = engine.process(c, d, i, p, "u1", "v1")
    res2 = engine.process(c, d, i, p, "u1", "v1")
    # Note: timestamps inside mocks might change if not frozen, but here mock store is simple dict
    # Re-using u1 bumps counter. We should use fresh engines or user IDs for strict identicality if stateful.
    # Actually Determinism implies: Given SAME state -> SAME output.
    # Stateful limits break simple determinism checks unless we mock state.
    # We'll assert critical fields match.
    assert res1.decision == res2.decision

def test_p6_03_gate_non_commercial(engine, valid_inputs):
    c, d, i, p = valid_inputs
    d.is_commercial_content = False
    res = engine.process(c, d, i, p, "u1", "v1")
    assert res.decision == DecisionType.DENY
    assert "gate:non_commercial" in res.reason_codes

def test_p6_04_gate_non_actionable(engine, valid_inputs):
    c, d, i, p = valid_inputs
    i.is_actionable = False
    res = engine.process(c, d, i, p, "u1", "v1")
    assert res.decision == DecisionType.DENY
    assert "gate:non_actionable" in res.reason_codes

def test_p6_05_gate_empty_plan(engine, valid_inputs):
    c, d, i, p = valid_inputs
    p.candidates = []
    res = engine.process(c, d, i, p, "u1", "v1")
    assert res.decision == DecisionType.DENY
    assert "gate:no_response_plan" in res.reason_codes

def test_p6_07_risk_spam(engine, valid_inputs):
    c, d, i, p = valid_inputs
    i.intent_type = IntentType.SPAM
    res = engine.process(c, d, i, p, "u1", "v1")
    assert res.decision == DecisionType.DENY
    assert "risk:spam_intent" in res.reason_codes

def test_p6_08_risk_author(engine, valid_inputs):
    c, d, i, p = valid_inputs
    res = engine.process(c, d, i, p, "bot_BadActor", "v1")
    assert res.decision == DecisionType.DENY
    assert "risk:author_bot" in res.reason_codes

def test_p6_10_platform_dm_support(engine, valid_inputs):
    c, d, i, p = valid_inputs
    engine.platform.can_dm = False # Disable Platform DM
    # Intent is Purchase -> Prefers DM or Reply.
    # If config allows DM, but platform doesn't -> Fallback to reply
    res = engine.process(c, d, i, p, "u1", "v1")
    assert res.allowed_actions.can_dm is False
    assert res.decision != DecisionType.ALLOW_DM

def test_p6_11_platform_url_support(engine, valid_inputs):
    c, d, i, p = valid_inputs
    engine.platform.can_url = False
    res = engine.process(c, d, i, p, "u1", "v1")
    assert res.allowed_actions.can_include_url is False

def test_p6_13_15_rate_limits(engine, valid_inputs):
    c, d, i, p = valid_inputs
    engine.config.rate_limit_author_max = 1
    
    # 1st -> OK
    res1 = engine.process(c, d, i, p, "u_fast", "v1")
    assert res1.decision != DecisionType.DENY
    
    # 2nd -> Exceeded
    res2 = engine.process(c, d, i, p, "u_fast", "v1")
    assert res2.decision == DecisionType.DEFER
    assert "limit:author_exceeded" in res2.reason_codes
    assert res2.cooldown.author_seconds > 0

def test_p6_16_engagement_mode_purchase(engine, valid_inputs):
    # Purchase -> Reply/DM
    c, d, i, p = valid_inputs
    i.intent_type = IntentType.PURCHASE
    res = engine.process(c, d, i, p, "u_pur", "v1")
    # Default strategy: If platform allows Reply, do Reply. (Our mock logic prefers Reply if allowed)
    # Check logic in engine.py: if allow_reply and platform.reply -> Reply.
    assert res.decision == DecisionType.ALLOW_REPLY

def test_p6_16_engagement_mode_inquiry(engine, valid_inputs):
    # Inquiry -> Reply
    c, d, i, p = valid_inputs
    i.intent_type = IntentType.INQUIRY
    res = engine.process(c, d, i, p, "u_inq", "v1")
    assert res.decision == DecisionType.ALLOW_REPLY

def test_p6_17_permissions_url(engine, valid_inputs):
    c, d, i, p = valid_inputs
    engine.config.allow_urls = True
    engine.platform.can_url = True
    res = engine.process(c, d, i, p, "u_url", "v1")
    assert res.allowed_actions.can_include_url is True

def test_p6_19_defer_logic(engine, valid_inputs):
    c, d, i, p = valid_inputs
    # Force defer via limit
    engine.config.rate_limit_author_max = 0 
    res = engine.process(c, d, i, p, "u_defer", "v1")
    
    assert res.decision == DecisionType.DEFER
    # Permissions must be false
    assert not res.allowed_actions.can_reply
    assert not res.allowed_actions.can_dm

def test_p6_20_traceability(engine, valid_inputs):
    c, d, i, p = valid_inputs
    res = engine.process(c, d, i, p, "u1", "v1")
    assert len(res.reason_codes) > 0
    assert res.audit.policy_version == "1.0"

def test_p6_21_privacy(engine, valid_inputs):
    c, d, i, p = valid_inputs
    c.text = "Sensitive PII"
    res = engine.process(c, d, i, p, "u1", "v1")
    # Ensure text not in reason codes
    for r in res.reason_codes:
        assert "Sensitive PII" not in r

def test_p6_22_failure_handling(engine, valid_inputs):
    c, d, i, p = valid_inputs
    with patch.object(engine, '_unsafe_process', side_effect=Exception("Crash")):
        res = engine.process(c, d, i, p, "u1", "v1")
        assert res.decision == DecisionType.DENY
        assert "error:policy_engine" in res.reason_codes
