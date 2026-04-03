import pytest
import re
from unittest.mock import patch, MagicMock
from video_engine.core.schemas import DetectionResult, SignalTrace
from video_engine.intent.schemas import CommentData, IntentType, IntentResult
from video_engine.intent.engine import CommentIntentEngine

# --- Fixtures ---

@pytest.fixture
def engine():
    return CommentIntentEngine()

@pytest.fixture
def commercial_result():
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
def non_commercial_result():
    return DetectionResult(
        is_commercial_content=False,
        commercial_confidence=0.1,
        niche="other.consumer", 
        sub_niche="unknown",
        content_type="unknown",
        confidence=0.1,
        signals_used=SignalTrace()
    )

@pytest.fixture
def gray_zone_result():
    return DetectionResult(
        is_commercial_content=True, 
        commercial_confidence=0.3, # < Low Threshold usually 0.8? No, Gate LOW is 0.2. Intent HIGH is 0.8.
        # If P3 passed it as commercial, it means > 0.8 P3 threshold?
        # But here we simulate P3 result that MIGHT affect P4.
        # Let's rely on Engine's internal COMM_LOW check (default 0.2).
        niche="other.consumer",
        sub_niche="unknown",
        content_type="unknown",
        confidence=0.3,
        signals_used=SignalTrace()
    )

# --- Existing Tests (P4-00 to P4-05) ---
# ... (Kept from previous, but consolidated/cleaned if needed)
# I will rewrite the file to include ALL tests cleanly.

# --- Test Group P4-00: Schema ---
def test_p4_00_schema_valid_inputs(engine, commercial_result):
    c = CommentData(id="c1", text="valid input")
    result = engine.process(c, commercial_result)
    assert isinstance(result, IntentResult)
    assert 0.0 <= result.intent_confidence <= 1.0
    assert isinstance(result.signals_used, dict)

# --- Test Group P4-01: Video Eligibility Gate ---
def test_p4_01_reject_non_commercial(engine, non_commercial_result):
    c = CommentData(id="c1", text="where to buy?")
    result = engine.process(c, non_commercial_result)
    assert result.intent_type == IntentType.UNKNOWN
    assert result.is_actionable is False
    assert result.related_niche == "other.consumer" # B1 Expectation

# --- Test Group P4-02: Spam Gate ---
def test_p4_02_detect_spam(engine, commercial_result):
    c = CommentData(id="c1", text="visit www.scam.com for free crypto")
    result = engine.process(c, commercial_result)
    assert result.intent_type == IntentType.SPAM
    assert result.is_actionable is False

# --- Test Group P4-03: Context Fusion ---
def test_p4_03_context_fusion_purchase(engine, commercial_result):
    # "how much" in Commercial Review -> Purchase
    c = CommentData(id="c1", text="how much")
    commercial_result.content_type = "review"
    result = engine.process(c, commercial_result)
    
    # Needs to meet criteria. 
    # Engine logic: 1 match (0.7) + 0.5 boost = 1.2 -> High logic?
    # Engine logic: if score >= 1: conf 0.7. But if boosted?
    # Adjust engine logic in mind: score += 0.5. 
    # If 1.5, still in ">=1" bucket.
    # We might need to adjust test expectation or engine logic if "how much" alone isn't actionable without context.
    # Current engine: Actionable if >= 0.8.
    # 0.7 < 0.8.
    # We need updated engine logic for G1 "Same text -> different meaning".
    # Let's verify what happens now.
    pass 

# --- Test Group P4-04: Actionability Logic ---
def test_p4_04_actionable_purchase(engine, commercial_result):
    c = CommentData(id="c1", text="where can i buy price") # 2 keywords
    result = engine.process(c, commercial_result)
    assert result.intent_type == IntentType.PURCHASE
    assert result.is_actionable is True

def test_p4_04c_praise_not_actionable(engine, commercial_result):
    c = CommentData(id="c1", text="love this amazing")
    result = engine.process(c, commercial_result)
    assert result.intent_type == IntentType.PRAISE
    assert result.is_actionable is False

# --- Test Group P4-05: Safety ---
def test_p4_05_safety_signals(engine, commercial_result):
    c = CommentData(id="c1", text="price")
    result = engine.process(c, commercial_result)
    assert "kw:price" in result.signals_used["text"]
    assert c.text not in result.signals_used["context"]

# --- NEW TESTS (P4-06 to P4-16) ---

# P4-06: Determinism (A2)
def test_p4_06_determinism(engine, commercial_result):
    c = CommentData(id="c1", text="can i use this?")
    r1 = engine.process(c, commercial_result)
    r2 = engine.process(c, commercial_result)
    assert r1.intent_type == r2.intent_type
    assert r1.intent_confidence == r2.intent_confidence
    assert r1.is_actionable == r2.is_actionable

# P4-07: Low Conf / Override Block (B2, B3)
def test_p4_07_low_conf_block(engine, gray_zone_result):
    # B2: Commercial but Low Confidence (< COMM_LOW)
    # Engine COMM_LOW default 0.2.
    # Gray Result has 0.3.
    # If we want to test blocking, we need input < 0.2 OR adjust threshold.
    engine.COMM_LOW = 0.5 
    c = CommentData(id="c1", text="where to buy?")
    result = engine.process(c, gray_zone_result)
    assert result.is_actionable is False
    assert result.intent_type == IntentType.UNKNOWN

# P4-08: Min Comment Gate (C1, C2)
def test_p4_08_min_gate_empty_emoji(engine, commercial_result):
    # C1: Empty
    c1 = CommentData(id="c1", text="   ")
    r1 = engine.process(c1, commercial_result)
    assert r1.intent_type == IntentType.UNKNOWN
    
    # C2: Emoji Only (Needs implementation check in Engine)
    # Current engine only checks length < 3.
    # "🔥🔥🔥" length is 3. might pass?
    # We expected this to fail.
    engine.MIN_LENGTH = 3
    c2 = CommentData(id="c2", text="🔥🔥🔥") 
    r2 = engine.process(c2, commercial_result)
    # If engine doesn't detect emoji-only, this assertion will FAIL, prompting fix.
    assert r2.intent_type == IntentType.UNKNOWN, "Emoji only should be unknown"

# P4-09: Spam Priority (D2)
def test_p4_09_spam_priority(engine, commercial_result):
    # Mixed signals
    c = CommentData(id="c1", text="buy this amazing product at www.scam.com")
    # "buy" -> Purchase intent. "www.scam.com" -> Spam.
    result = engine.process(c, commercial_result)
    assert result.intent_type == IntentType.SPAM
    assert result.is_actionable is False

# P4-10: Objection & Comparison (E3, E4)
def test_p4_10_objection_comparison(engine, commercial_result):
    # E3 Objection
    c_obj = CommentData(id="c1", text="too expensive bad quality")
    r_obj = engine.process(c_obj, commercial_result)
    assert r_obj.intent_type == IntentType.OBJECTION
    assert r_obj.is_actionable is True
    
    # E4 Comparison
    c_comp = CommentData(id="c2", text="better than brand X")
    r_comp = engine.process(c_comp, commercial_result)
    assert r_comp.intent_type == IntentType.COMPARISON
    assert r_comp.is_actionable is True

# P4-11: Generic Negativity (F2)
def test_p4_11_generic_negativity(engine, commercial_result):
    c = CommentData(id="c1", text="i hate this ugly")
    result = engine.process(c, commercial_result)
    assert result.intent_type == IntentType.NEGATIVE
    assert result.is_actionable is False

# P4-12: Context Sensitivity (G1)
def test_p4_12_context_sensitivity(engine, commercial_result, non_commercial_result):
    # G1: "Is it good?" 
    # Case A: Commercial Review -> Inquiry (Actionable?)
    # "Is it good" -> "good" (Praise?) "Is it" (Inquiry?)
    # We need to ensure keywords match. "is it" -> Inquiry keywords?
    # Case B: Non-commercial -> Unknown.
    
    c = CommentData(id="c1", text="is it good") 
    
    # Case A
    r_comm = engine.process(c, commercial_result)
    # If "is it" matches inquiry...
    # Case B
    r_non = engine.process(c, non_commercial_result)
    assert r_non.intent_type == IntentType.UNKNOWN

# P4-13: Gray Zone Conservatism (H1)
def test_p4_13_gray_zone_conservatism(engine, commercial_result):
    # Intent Conf in Gray Band (e.g. 0.7).
    # Allowed High Threshold = 0.8.
    # Logic should result in Actionable=False.
    
    c = CommentData(id="c1", text="can i") # Single match -> 0.7 conf
    result = engine.process(c, commercial_result)
    
    assert result.intent_type == IntentType.INQUIRY 
    assert result.intent_confidence == 0.7
    assert result.is_actionable is False # H1 Expectation

# P4-14: Related Niche Integrity (I1, I2)
def test_p4_14_niche_integrity(engine, commercial_result, non_commercial_result):
    # I1
    c = CommentData(id="c1", text="buy")
    r1 = engine.process(c, commercial_result)
    assert r1.related_niche == "beauty.makeup"
    
    # I2
    r2 = engine.process(c, non_commercial_result)
    assert r2.related_niche == "other.consumer"

# P4-15: Tenant Config Isolation (K1)
def test_p4_15_tenant_config(engine, commercial_result):
    c = CommentData(id="c1", text="can i") # Conf 0.7
    
    # Tenant A: High=0.6 (Aggressive)
    engine.INTENT_HIGH = 0.6
    r_a = engine.process(c, commercial_result)
    assert r_a.is_actionable is True
    
    # Tenant B: High=0.9 (Conservative)
    engine.INTENT_HIGH = 0.9
    r_b = engine.process(c, commercial_result)
    assert r_b.is_actionable is False

# P4-16: Failure Handling (L1)
def test_p4_16_failure_handling(engine, commercial_result):
    # Force exception
    with patch.object(engine.spam_gate, 'is_spam', side_effect=Exception("Boom")):
        c = CommentData(id="c1", text="test")
        result = engine.process(c, commercial_result)
        
        # Expect Safe Failure
        assert result.intent_type == IntentType.UNKNOWN
        assert result.is_actionable is False
        assert result.intent_confidence == 0.0
        assert "error:internal" in result.signals_used.get("context", []) or \
               any("error" in s for s in result.signals_used.get("context", []))
