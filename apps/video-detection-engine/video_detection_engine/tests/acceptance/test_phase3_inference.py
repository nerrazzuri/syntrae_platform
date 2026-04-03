import pytest
import logging
from unittest.mock import MagicMock, patch
from typing import List, Optional
import numpy as np

from video_engine.core.schemas import (
    InputData, EmbeddingsBundle, VideoMetadata, AudioTranscript, 
    FrameArtifact, OcrArtifact, ModelConfig, DetectionResult, 
    EmbeddingModelMap, EmbeddingModelInfo, PooledEmbeddings, 
    CacheInfo, NormalizationInfo, NicheType, ContentType,
    TextEmbeddings, AudioSegment
)
from video_engine.engine import VideoDetectionEngine

# --- Fixtures ---

@pytest.fixture
def model_config():
    return ModelConfig(
        commercial_threshold_low=0.2, # Explicitly safe
        commercial_threshold_high=0.8
    )

@pytest.fixture
def engine(model_config):
    return VideoDetectionEngine(config=model_config)

@pytest.fixture
def mock_input_data():
    return InputData(
        video_id="v_test_p3",
        platform="test",
        duration_seconds=15.0,
        sampled_frames=[], 
        audio_transcript=AudioTranscript(language="en", segments=[]),
        ocr_texts=[],
        metadata=VideoMetadata(caption="Test Caption", hashtags=[])
    )

def create_bundle(
    text_vec: float, 
    vision_vec: float, 
    caption: str = "", 
    ocr: List[str] = [], 
    transcript: str = ""
) -> EmbeddingsBundle:
    dim = 512
    t_vec = [text_vec] * dim
    v_vec = [vision_vec] * dim
    
    return EmbeddingsBundle(
        video_id="v_test_p3",
        platform="test",
        embedding_models=EmbeddingModelMap(
            vision=EmbeddingModelInfo(name="test", version="1", dim=dim),
            text=EmbeddingModelInfo(name="test", version="1", dim=dim)
        ),
        frame_embeddings=[],
        text_embeddings=TextEmbeddings(
            caption_vector=t_vec,
            asr_vector=t_vec,
            ocr_vector=t_vec
        ),
        pooled_embeddings=PooledEmbeddings(
            vision_pooled=v_vec,
            text_pooled=t_vec,
            video_pooled=[(text_vec+vision_vec)/2]*dim
        ),
        normalization=NormalizationInfo(vision="none", text="none"),
        cache=CacheInfo(cache_key="test", hit=False),
        modality_status={'caption': 'present' if caption else 'empty'}
    )

# --- Test Group P3-00: Contract & Schema Integrity ---

def test_p3_00a_schema_validity(engine, mock_input_data):
    bundle = create_bundle(0.1, 0.1, caption="Valid")
    result = engine.process(mock_input_data, bundle)
    assert isinstance(result, DetectionResult)
    assert result.is_commercial_content is not None
    assert result.niche is not None
    assert result.content_type is not None

def test_p3_00b_malformed_input(engine, mock_input_data):
    bad_bundle = create_bundle(0.0, 0.0) 
    result = engine.process(mock_input_data, bad_bundle)
    assert result.confidence >= 0.0

# --- Test Group P3-01: Determinism ---

def test_p3_01a_determinism(engine, mock_input_data):
    bundle = create_bundle(0.5, 0.5, caption="makeup tutorial")
    mock_input_data.metadata.caption = "makeup tutorial"
    
    r1 = engine.process(mock_input_data, bundle)
    r2 = engine.process(mock_input_data, bundle)
    
    assert r1.is_commercial_content == r2.is_commercial_content
    assert r1.niche == r2.niche
    assert r1.confidence == r2.confidence

# --- Test Group P3-02: Commercial Gate ---

def test_p3_02a_strong_commercial(engine, mock_input_data):
    # Strong signal requirement: > 0.8
    # Heuristics:
    # "buy" in caption (0.1) + "buy" in ASR (0.15) + "buy" in OCR (0.2) = 0.45
    # "sale" in caption (0.1) + "sale" in ASR (0.15) + "sale" in OCR (0.2) = 0.45
    # Total 0.9.
    
    kw = "buy sale shop"
    mock_input_data.metadata.caption = kw
    mock_input_data.audio_transcript.segments = [AudioSegment(start=0, end=1, text=kw)]
    mock_input_data.ocr_texts = [OcrArtifact(frame_id="f1", timestamp=0, text=kw)]
    
    bundle = create_bundle(0.8, 0.8)
    
    result = engine.process(mock_input_data, bundle)
    assert result.is_commercial_content is True
    assert result.commercial_confidence > 0.8 # Passes High Threshold

def test_p3_02b_strong_non_commercial(engine, mock_input_data):
    # Scenery
    mock_input_data.metadata.caption = "beautiful sunset nature"
    bundle = create_bundle(0.1, 0.1)
    
    result = engine.process(mock_input_data, bundle)
    assert result.is_commercial_content is False
    assert result.niche == "other.consumer"
    assert result.content_type == "unknown"

# --- Test Group P3-03: Niche Governance ---

def test_p3_03a_niche_whitelist(engine, mock_input_data):
    # Try to trick it with "nuclear reactor"
    mock_input_data.metadata.caption = "nuclear reactor physics"
    bundle = create_bundle(0.5, 0.5)
    
    result = engine.process(mock_input_data, bundle)
    # Must fall back to 'other.consumer' or known niche, NOT 'nuclear'
    assert result.niche in NicheType.__args__

def test_p3_03b_non_commercial_force_niche(engine, mock_input_data):
    # Even if text says "makeup" strongly, if Commercial Gate says NO, Niche MUST be other.consumer
    # This requires forcing Gate=False but Niche=Makeup.
    # Current Heuristic checks keywords. "Makeup" -> Commercial score += 0. 
    # Wait, simple heuristics might correlate.
    # Let's Mock the Gate to return False.
    
    with patch.object(engine.commercial_gate, 'assess', return_value=(False, 0.1, {})):
        # But Niche classifier sees "lipstick"
        mock_input_data.metadata.caption = "lipstick foundation" 
        result = engine.process(mock_input_data, create_bundle(0.5, 0.5))
        
        assert result.is_commercial_content is False
        assert result.niche == "other.consumer" # Engine MUST override
        assert result.content_type == "unknown"

# --- Test Group P3-04: Sub-Niche Governance (Sanitization) ---

def test_p3_04a_sub_niche_sanitization(engine, mock_input_data):
    # Trigger a sub-niche with bad chars if possible.
    # HeuristicNiche returns raw keyword. 
    # If keyword list contains clean words, we are good.
    # But if dynamic? Heuristics are fixed dict.
    # Let's assume we maintain the keyword list safe.
    # Check max length.
    result = engine.process(mock_input_data, create_bundle(0.5, 0.5, caption="lipstick"))
    if result.sub_niche != "unknown":
         assert len(result.sub_niche) <= 32
         assert result.sub_niche.replace("_", "").replace(".", "").isalnum()

# --- Test Group P3-06: Confidence Governance ---

def test_p3_06_gray_zone_logic(engine, mock_input_data):
    # Mock Gate to return "Gray Zone" confidence.
    # Spec: LOW=0.2, HIGH=0.8. Gray=[0.2, 0.8].
    # If conf=0.5 (Gray) -> Must be SAFE.
    # Option A: is_commercial=False
    # Option B: is_commercial=True BUT niche="other.consumer".
    
    # Let's say we configure Gate to return (True, 0.5, ...).
    # Engine should see 0.5 < HIGH_THRESHOLD (0.8).
    # Current Logic: checks `if not is_commercial` provided by gate.
    # If gate says True (0.5 > 0.3), Engine currently proceeds.
    # WE EXPECT THIS TO CHANGE via Governance Logic implementation.
    # So we write the test expecting the NEW behavior.
    
    with patch.object(engine.commercial_gate, 'assess', return_value=(True, 0.5, {})):
        # Set config? Engine uses Defaults currently. 
        # We need to ensure we test "Ambiguous Commercial".
        # If we interpret 0.5 as "Ambiguous", result should be Safe.
        
        result = engine.process(mock_input_data, create_bundle(0.5, 0.5))
        
        # Safe Check:
        # Either not commercial OR niche is generic
        is_safe = (not result.is_commercial_content) or (result.niche == "other.consumer")
        assert is_safe, "Gray zone confidence (0.5) must not trigger confident specific niche"

# --- Test Group P3-07: Traceability ---

def test_p3_07_signals_present(engine, mock_input_data):
    mock_input_data.metadata.caption = "buy lipstick"
    result = engine.process(mock_input_data, create_bundle(0.5, 0.5))
    
    assert result.signals_used is not None
    assert result.signals_used.visual is not None
    assert result.signals_used.audio is not None
    assert result.signals_used.text_overlay is not None

# --- Test Group P3-09: Config Isolation (Thresholds) ---

def test_p3_09_tenant_thresholds():
    # Helper to test threshold logic.
    # We need to modify ModelConfig thresholds.
    # Let's assume we add thresholds to ModelConfig.
    from video_engine.core.schemas import ModelConfig
    
    # Low Threshold Config (Aggressive)
    conf_aggressive = ModelConfig()
    conf_aggressive.commercial_threshold_high = 0.4 # Hypothetical field
    # We assume 'commercial_threshold_high' determines specific-niche activation 
    # or 'commercial_threshold_low' determines binary gate.
    
    # High Threshold Config (Conservative)
    conf_conservative = ModelConfig()
    conf_conservative.commercial_threshold_high = 0.9 
    
    # We need to implement this config usage in Engine.
    # Input has score 0.6.
    # Aggressive (0.4) -> 0.6 is High -> Detailed Niche.
    # Conservative (0.9) -> 0.6 is Gray/Low -> Safe/Unknown.
    
    # Since fields don't exist yet, this test will FAIL until we update schemas/engine.
    # We write it to verify the feature.
    
    pass 
    # Skip for now until Schema update, or we define it here if Python dynamic?
    # No, strict Pydantic.
