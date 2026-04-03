import pytest
import uuid
from ai_core.services.lead_scoring_service import LeadScoringService
from shared.database.models import BuyerStage, RecommendedAction

class MockSession:
    def add(self, obj): pass
    def commit(self): pass
    def refresh(self, obj): pass
    def __enter__(self): return self
    def __exit__(self, exc_type, exc_val, exc_tb): pass

@pytest.fixture
def scorer():
    return LeadScoringService()

@pytest.fixture
def context():
    return {
        "platform": "tiktok",
        "comment_id": "c123",
        "video_id": "v123",
        "source_event_id": str(uuid.uuid4()),
        "user_handle": "test_user",
        "account_id": str(uuid.uuid4())
    }

def test_ready_signal(scorer, context):
    signals = [{"type": "PRODUCT_INQUIRY", "confidence": 0.9}]
    text = "Where can I buy this?"
    ts_intents = ["PRODUCT_INQUIRY"]
    
    stage, intent, conf, meta = scorer._map_to_stage(signals, ts_intents, text)
    assert stage == BuyerStage.READY
    assert intent == "PRODUCT_INQUIRY"
    
    action = scorer._determine_action(stage, conf, context)
    assert action == RecommendedAction.PRIORITY_DM

def test_evaluating_signal(scorer, context):
    signals = [{"type": "VALUE_EVALUATION", "confidence": 0.85}]
    text = "Is it worth the price?"
    ts_intents = []
    
    stage, intent, conf, meta = scorer._map_to_stage(signals, ts_intents, text)
    assert stage == BuyerStage.EVALUATING
    assert intent == "VALUE_EVALUATION"
    
    action = scorer._determine_action(stage, conf, context)
    assert action == RecommendedAction.RECOMMEND_DM

def test_awareness_signal(scorer, context):
    signals = [{"type": "AESTHETIC_PREFERENCE", "confidence": 0.9}]
    text = "I love the color!"
    ts_intents = []
    
    stage, intent, conf, meta = scorer._map_to_stage(signals, ts_intents, text)
    assert stage == BuyerStage.AWARENESS
    assert intent == "INTEREST"
    
    action = scorer._determine_action(stage, conf, context)
    assert action == RecommendedAction.SILENT_CAPTURE

def test_keyword_fallback(scorer, context):
    signals = []
    text = "how much does it cost"
    ts_intents = []
    
    stage, intent, conf, meta = scorer._map_to_stage(signals, ts_intents, text)
    assert stage == BuyerStage.READY
    assert intent == "PRICING_INQUIRY"

def test_no_signal(scorer, context):
    signals = []
    text = "hello"
    ts_intents = []
    
    stage, intent, conf, meta = scorer._map_to_stage(signals, ts_intents, text)
    assert stage is None
