import json
import logging
import time
import os
from video_engine.core.schemas import (
    InputData, VideoMetadata, FrameArtifact, AudioTranscript, 
    OcrArtifact, EmbeddingConfig, EmbeddingsBundle
)
from video_engine.embeddings.orchestrator import EmbeddingOrchestrator

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("verify_embeddings")

def create_mock_data(vid_id: str) -> InputData:
    # Ensure dummy image exists for strict file checking
    if not os.path.exists("mock_frame_1.jpg"):
        from PIL import Image
        img = Image.new('RGB', (100, 100), color = 'red')
        img.save('mock_frame_1.jpg')

    return InputData(
        video_id=vid_id,
        platform="test",
        duration_seconds=10.0,
        sampled_frames=[
            FrameArtifact(
                frame_id="f1", timestamp=0.0, storage_path="mock_frame_1.jpg", 
                width=100, height=100, format="jpg"
            )
        ],
        audio_transcript=AudioTranscript(language="en", segments=[]),
        ocr_texts=[],
        metadata=VideoMetadata(caption="Deterministic test", hashtags=[])
    )

def test_determinism_and_caching():
    print("--- Test 1: Determinism & Caching ---")
    
    # 1. Setup
    config = EmbeddingConfig(cache_enabled=True, fail_fast=True)
    orchestrator = EmbeddingOrchestrator(config)
    data = create_mock_data("det_1")
    
    # 2. Run 1
    logger.info("Run 1...")
    bundle1 = orchestrator.process(data)
    
    # 3. Run 2
    logger.info("Run 2...")
    bundle2 = orchestrator.process(data)
    
    # 4. Compare Vectors (Determinism)
    # Using JSON dump to compare deep structure equality
    # Note: Cache hit status might differ (Run 2 hit = True), so exclude cache info for equality check
    b1_dump = bundle1.model_dump(exclude={'cache'})
    b2_dump = bundle2.model_dump(exclude={'cache'})
    
    if b1_dump == b2_dump:
        print("✅ PASS: Determinism (Outputs identical)")
    else:
        print("❌ FAIL: Determinism (Outputs differ)")
        
    # 5. Verify Cache Hit
    if bundle2.cache.hit:
        print(f"✅ PASS: Cache Hit (Key: {bundle2.cache.cache_key})")
    else:
        print("❌ FAIL: Cache Miss on second run")
        # Check if in-memory store persists
        # Orchestrator creates new Cache instance? 
        # Ah, EmbeddingOrchestrator instantiates cache internally. 
        # If we re-instantiate Orchestrator, memory cache is lost.
        # THIS SCRIPT instantiates Orchestrator ONCE. So it should hit.

def test_fail_fast():
    print("\n--- Test 2: Fail-Fast ---")
    config = EmbeddingConfig(model_name="non_existent_model_xyz", fail_fast=True)
    try:
        orchestrator = EmbeddingOrchestrator(config)
        print("❌ FAIL: Should have raised RuntimeError")
    except RuntimeError as e:
        print(f"✅ PASS: Caught expected error: {e}")
    except Exception as e:
        print(f"⚠️ WARN: Caught unexpected exception type: {type(e)}: {e}")

def test_missing_modalities():
    print("\n--- Test 3: Missing Modalities ---")
    config = EmbeddingConfig()
    orchestrator = EmbeddingOrchestrator(config)
    
    data = create_mock_data("missing_1")
    data.sampled_frames = [] # No visuals
    data.metadata.caption = "" 
    
    bundle = orchestrator.process(data)
    
    # 1. Vision: Empty list -> Zero Vector (Pooled)
    if bundle.pooled_embeddings.vision_pooled == [0.0]*512:
        print("✅ PASS: Missing Visuals handled (Zero Vector)")
    else:
        print(f"❌ FAIL: Expected Zero Vector for missing visuals, got {bundle.pooled_embeddings.vision_pooled[:5]}...")

    # 2. Text: Empty string -> [EMPTY] Vector (Non-Zero)
    if bundle.text_embeddings.caption_vector != [0.0]*512:
        print("✅ PASS: Missing Caption handled ([EMPTY] Vector)")
    else:
        print("❌ FAIL: Expected Non-Zero Vector for missing caption")

    # 3. Status Check
    status = bundle.modality_status
    if status["caption"] == "empty" and status["vision_frames"] == "empty" and status["asr"] == "no_audio":
        print(f"✅ PASS: Modality Status Correct ({status})")
    else:
        print(f"❌ FAIL: Incorrect Modality Status: {status}")

if __name__ == "__main__":
    test_determinism_and_caching()
    test_fail_fast()
    test_missing_modalities()
