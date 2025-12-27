import pytest
from unittest.mock import patch, MagicMock
from video_engine.generation.schemas import (
    GenerationConfig, MessageResult, GenerationMode, MessageTemplateType
)
from video_engine.generation.engine import MessageGenerationEngine
from video_engine.policy.schemas import EnforcementDecision, DecisionType, Constraints
from video_engine.rag.schemas import ResponsePlan, ResponseCandidate, ResponseType
from video_engine.rag_gateway.service import RAGGatewayService
from video_engine.rag_gateway.schemas import ContentResponse, DocumentContent

# --- Fixtures ---

@pytest.fixture
def mock_gateway():
    gateway = MagicMock(spec=RAGGatewayService)
    # Default behavior: Return empty content or mock content
    gateway.process_content.return_value = ContentResponse(docs=[])
    return gateway

@pytest.fixture
def gen_config():
    return GenerationConfig(
        tenant_id="t1",
        enable_llm=False,
        max_length_reply=200,
        max_length_dm=500
    )

@pytest.fixture
def engine(gen_config, mock_gateway):
    return MessageGenerationEngine(gen_config, gateway=mock_gateway)

@pytest.fixture
def decision_allow_reply():
    return EnforcementDecision(
        decision=DecisionType.ALLOW_REPLY,
        engagement_type="reply",
        risk_level="low",
        allowed_knowledge_refs=["doc1:v1"],
        constraints=Constraints(max_message_length=200, tone="neutral", can_include_url=True, can_include_price=True),
        reason_codes=["approved"]
    )

@pytest.fixture
def decision_deny():
    return EnforcementDecision(
        decision=DecisionType.DENY,
        engagement_type="ignore",
        risk_level="high",
        allowed_knowledge_refs=[],
        constraints=Constraints(),
        reason_codes=["blocked"]
    )

@pytest.fixture
def plan_product():
    return ResponsePlan(
        candidates=[ResponseCandidate(response_type=ResponseType.PRODUCT_INFO, confidence=0.9, knowledge_refs=["doc1:v1"])],
        selected_language="en"
    )

# --- Tests ---

def test_p8_01_gateway_fetch_allowed_refs(engine, mock_gateway, decision_allow_reply, plan_product):
    """Verify engine calls gateway with strictly allowed refs."""
    mock_gateway.process_content.return_value = ContentResponse(docs=[
        DocumentContent(doc_id="doc1", version="v1", content="Great product info.")
    ])
    
    res = engine.process(GenerationMode.REPLY, decision_allow_reply, plan_product, "tiktok", "token", "trace_id")
    
    mock_gateway.process_content.assert_called_once()
    args, _ = mock_gateway.process_content.call_args
    assert args[1].doc_refs == ["doc1:v1"]
    assert args[1].trace_id == "trace_id" # Verify trace_id
    assert res.message_text != ""

def test_p8_02_gateway_hard_fail_extra(engine, mock_gateway, decision_allow_reply, plan_product):
    """Verify hard fail if gateway returns extra unauthorized content (Phase 0 violation)."""
    # Allowed: doc1:v1
    # Gateway returns: doc1:v1 AND doc2:v1
    mock_gateway.process_content.return_value = ContentResponse(docs=[
        DocumentContent(doc_id="doc1", version="v1", content="ok"),
        DocumentContent(doc_id="doc2", version="v1", content="extra")
    ])
    
    res = engine.process(GenerationMode.REPLY, decision_allow_reply, plan_product, "tiktok", "token", "trace_id")
    
    assert res.message_text == ""
    assert "violation:extra_ref_fetched:doc2:v1" in res.safety_flags

def test_p8_03_gateway_hard_fail_missing(engine, mock_gateway, decision_allow_reply, plan_product):
    """Verify hard fail if required content is missing."""
    mock_gateway.process_content.return_value = ContentResponse(docs=[])
    
    res = engine.process(GenerationMode.REPLY, decision_allow_reply, plan_product, "tiktok", "token", "trace_id")
    
    assert res.message_text == ""
    assert "violation:missing_content:doc1:v1" in res.safety_flags

def test_p8_04_gateway_crash_safe_fail(engine, mock_gateway, decision_allow_reply, plan_product):
    """Verify engine handles Gateway crash gracefully (Fail-Closed)."""
    mock_gateway.process_content.side_effect = Exception("Gateway Down")
    
    res = engine.process(GenerationMode.REPLY, decision_allow_reply, plan_product, "tiktok", "token", "trace_id")
    
    assert res.message_text == ""
    assert "error:gateway_fetch:Gateway Down" in res.safety_flags

def test_p8_05_template_content_injection(engine, mock_gateway, decision_allow_reply, plan_product):
    """Verify RAG content is actually injected into the template."""
    mock_gateway.process_content.return_value = ContentResponse(docs=[
        DocumentContent(doc_id="doc1", version="v1", content="$50 Special Deal") 
    ])
    decision_allow_reply.constraints.can_include_price = True
    
    # PRODUCT_INFO -> PURCHASE_INFO template -> "Price: {price}"
    res = engine.process(GenerationMode.REPLY, decision_allow_reply, plan_product, "tiktok", "token", "trace_id")
    
    assert "$50 Special Deal" in res.message_text

def test_p8_06_permission_no_url_hard_fail(engine, mock_gateway, decision_allow_reply, plan_product):
    """Verify hard fail if generated message contains URL when disallowed."""
    decision_allow_reply.constraints.can_include_url = False
    
    # RAG content has URL
    mock_gateway.process_content.return_value = ContentResponse(docs=[
        DocumentContent(doc_id="doc1", version="v1", content="http://bad.com")
    ])
    
    # If template injects this content directly...
    # We patch _generate_via_template to ensure it comes out in the message
    with patch.object(engine, '_generate_via_template', return_value=("Check http://bad.com", ["doc1:v1"], "t")):
         res = engine.process(GenerationMode.REPLY, decision_allow_reply, plan_product, "tiktok", "token", "trace_id")
         
         assert res.message_text == ""
         assert "violation:url_present" in res.safety_flags

def test_p8_07_unauthorized_ref_hard_fail(engine, mock_gateway, decision_allow_reply, plan_product):
    """Verify hard fail if generation claims to use a ref not in allowed list."""
    # This checks internal consistency of the engine logic
    mock_gateway.process_content.return_value = ContentResponse(docs=[
        DocumentContent(doc_id="doc1", version="v1", content="ok")
    ])
    
    # Force _generate_via_template to return unauthorized ref
    with patch.object(engine, '_generate_via_template', return_value=("Msg", ["doc2:v1"], "t")):
         res = engine.process(GenerationMode.REPLY, decision_allow_reply, plan_product, "tiktok", "token", "trace_id")
         
         assert res.message_text == ""
         assert "violation:unauthorized_ref:doc2:v1" in res.safety_flags
