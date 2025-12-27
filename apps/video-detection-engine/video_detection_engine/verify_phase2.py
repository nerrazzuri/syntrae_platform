import json
import logging
from video_engine.core.schemas import (
    InputData, VideoMetadata, ModelConfig, 
    FrameArtifact, AudioTranscript, AudioSegment, OcrArtifact
)
from video_engine.engine import VideoDetectionEngine

# Configure logging
logging.basicConfig(level=logging.INFO)

def main():
    print("--- Phase 2 Verification (Real Model Integration) ---")
    
    # 1. Setup Engine with Model Config (Paths are None, so falls back to Heuristics, but loads Embedding Model)
    # Note: If numpy error persists, embedding model might fail to load, but engine handles it.
    config = ModelConfig(
        embedding_model_name="clip-ViT-B-32",
        # commercial_classifier_path="models/comm.joblib", # Uncomment if you have real models
    ) 
    print(f"Initializing Engine with Config: {config}")
    engine = VideoDetectionEngine(config)
    
    # Check if embedding model loaded
    if engine.embedding_service._model:
        print("SUCCESS: Embedding Service loaded transformer model.")
    else:
        print("WARNING: Embedding Service failed to load model (using fallback).")

    # 2. Create Dummy Input (STRICT SCHEMA)
    # We construct the object graph manually to simulate an Ingestion result
    input_data = InputData(
        video_id="test_phase2_id",
        platform="tiktok",
        duration_seconds=15.0,
        sampled_frames=[
            FrameArtifact(
                frame_id="f1", timestamp=0.0, storage_path="mock_frame_1.jpg", 
                width=1080, height=1920, format="jpg"
            ),
            FrameArtifact(
                frame_id="f2", timestamp=1.0, storage_path="mock_frame_2.jpg", 
                width=1080, height=1920, format="jpg"
            )
        ],
        audio_transcript=AudioTranscript(
            language="en",
            segments=[
                AudioSegment(start=0.0, end=5.0, text="This is a makeup tutorial."),
                AudioSegment(start=5.0, end=10.0, text="I love this product.")
            ]
        ),
        ocr_texts=[
            OcrArtifact(frame_id="f1", timestamp=0.0, text="SALE 50% OFF"),
            OcrArtifact(frame_id="f2", timestamp=1.0, text="LINK IN BIO")
        ],
        metadata=VideoMetadata(
            caption="Amazing #makeup review",
            hashtags=["makeup", "beauty"]
        )
    )
    
    # 3. Process
    print("\nProcessing video...")
    result = engine.process(input_data)
    
    print("\nResult:")
    print(json.dumps(result.model_dump(), indent=2))
    
    # 4. Verify Output
    if result.is_commercial_content and result.niche == "beauty.makeup":
        print("\nSUCCESS: Classification logic working with new Schema (Heuristics matched keywords).")
    else:
        print("\nWARNING: Classification didn't match expected heuristics. Check Input Data.")

if __name__ == "__main__":
    main()
