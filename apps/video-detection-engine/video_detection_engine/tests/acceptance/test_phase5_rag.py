import pytest
import copy
from unittest.mock import MagicMock, patch
from video_engine.core.schemas import DetectionResult, SignalTrace
from video_engine.intent.schemas import CommentData, IntentType, IntentResult
from video_engine.rag.schemas import ResponsePlan, ResponseType, ResponseCandidate
from video_engine.rag.engine import RAGResponseEngine
from video_engine.rag_gateway.service import RAGGatewayService
from video_engine.rag_gateway.schemas import RetrieveResponse, SearchResult, GovernanceMetadata

# --- Fixtures ---

@pytest.fixture
def mock_gateway():
    gateway = MagicMock(spec=RAGGatewayService)
    return gateway

@pytest.fixture
def engine(mock_gateway):
    return RAGResponseEngine(gateway=mock_gateway)

@pytest.fixture
def detection_result():
    return DetectionResult(
        is_commercial_content=True,
        commercial_confidence=0.9,
        niche="beauty.makeup",
        sub_niche="lipstick",
        content_type="review",
        confidence=0.9,
        signals_used=SignalTrace()
    )

@pytest.fixture
def purchase_intent():
    return IntentResult(
        comment_id="c1",
        is_actionable=True,
        intent_type=IntentType.PURCHASE,
        intent_confidence=0.9,
        related_niche="beauty.makeup",
        signals_used={}
    )

@pytest.fixture
def mock_results():
    # Helper to build SearchResults
    def _make(doc_id, version, type_, score=0.9):
        return SearchResult(
            doc_id=doc_id,
            version=version,
            score=score,
            metadata=GovernanceMetadata(
                doc_type=type_,
                contains_url=False,
                contains_price=False,
                language="en",
                compliance_level="safe"
            )
        )
    return _make

# --- Tests ---

def test_p5_01_gateway_call_contract(engine, mock_gateway, detection_result, purchase_intent):
    """Verify Phase 5 calls RAG Gateway exactly once with correct token and payload."""
    c = CommentData(id="c1", text="price?")
    token = "mock_token"
    trace_id = "test_trace_id_123"
    
    mock_gateway.process_retrieve.return_value = RetrieveResponse(results=[])
    
    try:
        engine.process(c, detection_result, purchase_intent, token, "en", trace_id)
    except ValueError:
        pass # Expected since no results for Purchase
        
    mock_gateway.process_retrieve.assert_called_once()
    args, _ = mock_gateway.process_retrieve.call_args
    assert args[0] == token # Verify token passed
    assert args[1].query == "price?" # Verify query
    assert args[1].trace_id == trace_id # Verify trace_id propagation

def test_p5_02_metadata_filtering(engine, mock_gateway, detection_result, purchase_intent, mock_results):
    """Verify P5 filters docs by intent compatibility."""
    token = "mock_token"
    mock_gateway.process_retrieve.return_value = RetrieveResponse(results=[
        mock_results("doc1", "v1", "product_info"), # Allowed for Purchase
        mock_results("doc2", "v1", "faq"),          # Allowed for Purchase
        mock_results("doc3", "v1", "general")       # Generic mapped to GENERIC_HELP? 
                                                    # Purchase allows PRODUCT_INFO, FAQ.
                                                    # Generic -> GENERIC_HELP, not in Purchase allowed?
    ])
    
    plan = engine.process(CommentData(id="c1", text="abc"), detection_result, purchase_intent, token, "en")
    
    types = [c.response_type for c in plan.candidates]
    assert ResponseType.PRODUCT_INFO in types
    assert ResponseType.FAQ in types
    assert ResponseType.GENERIC_HELP not in types # Should be filtered out

def test_p5_03_risk_filtering(engine, mock_gateway, detection_result, purchase_intent, mock_results):
    """Verify P5 rejects risky docs based on metadata."""
    token = "val"
    risky_doc = mock_results("d1", "v1", "product_info")
    risky_doc.metadata.compliance_level = "risky"
    
    safe_doc = mock_results("d2", "v1", "product_info")
    
    mock_gateway.process_retrieve.return_value = RetrieveResponse(results=[risky_doc, safe_doc])
    
    plan = engine.process(CommentData(id="c1", text="abc"), detection_result, purchase_intent, token, "en")
    
    assert len(plan.candidates) == 1
    assert plan.candidates[0].knowledge_refs[0] == "d2:v1"

def test_p5_04_hard_fail_missing_knowledge(engine, mock_gateway, detection_result, purchase_intent):
    """Verify Hard Fail if Intent requires knowledge but none found."""
    mock_gateway.process_retrieve.return_value = RetrieveResponse(results=[])
    
    with pytest.raises(ValueError, match="No valid knowledge found"):
        engine.process(CommentData(id="c1", text="abc"), detection_result, purchase_intent, "t", "en")

def test_p5_05_gateway_failure_propagation(engine, mock_gateway, detection_result, purchase_intent):
    """Verify Gateway exceptions bubble up (Fail-Closed)."""
    mock_gateway.process_retrieve.side_effect = Exception("Gateway Down")
    
    with pytest.raises(Exception, match="Gateway Down"):
        engine.process(CommentData(id="c1", text="abc"), detection_result, purchase_intent, "t", "en")

def test_p5_06_no_content_leakage(engine, mock_gateway, detection_result, purchase_intent, mock_results):
    """Verify Plan contains only references, not content."""
    # Gateway returns Metadata only anyway, but check result structure.
    mock_gateway.process_retrieve.return_value = RetrieveResponse(results=[
        mock_results("d1", "v1", "product_info")
    ])
    
    plan = engine.process(CommentData(id="c1", text="abc"), detection_result, purchase_intent, "t", "en")
    cand = plan.candidates[0]
    assert cand.knowledge_refs == ["d1:v1"]
    # No text field in Candidate

def test_p5_07_actionability_gate(engine, mock_gateway, detection_result):
    """Verify non-actionable intent skips RAG call."""
    intent = IntentResult(
        comment_id="c1", is_actionable=False, intent_type=IntentType.UNKNOWN,
        intent_confidence=0.0, related_niche="n", signals_used={}
    )
    
    plan = engine.process(CommentData(id="c1", text="meh"), detection_result, intent, "t", "en")
    
    assert len(plan.candidates) == 0
    mock_gateway.process_retrieve.assert_not_called()
