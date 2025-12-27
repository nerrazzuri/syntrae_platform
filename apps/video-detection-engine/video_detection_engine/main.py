import json
from video_engine.core.schemas import InputData, VideoMetadata, VisualInput, AudioInput, OcrInput
from video_engine.engine import VideoDetectionEngine

def main():
    # 1. Setup Engine
    engine = VideoDetectionEngine()
    
    # 2. Create Dummy Input
    # Scenario: A Sephora haul / lipstick review
    input_data = InputData(
        # Required Legacy Fields
        video_id="v123",
        platform="tiktok",
        duration_seconds=45.0,
        sampled_frames=[], # Mock empty for demo
        audio_transcript={"language": "en", "segments": []}, # Pydantic auto-convert
        ocr_texts=[],
        metadata=VideoMetadata(
            caption="Check out this new red lipstick! #beauty #makeup #review",
            hashtags=["beauty", "makeup", "review"]
        ),
        
        # New Modality Fields
        visual=VisualInput(
            frames=["frame1.jpg", "frame2.jpg"] # Mock paths
        ),
        audio=AudioInput(
            transcript="Today I am reviewing this amazing matte lipstick. It costs only $20 and looks great. Watch me try it on.",
            segments=[{"start": 0.0, "end": 5.0, "text": "Today..."}]
        ),
        ocr=OcrInput(
            text="Price: $20\nMatte Finish\nReview"
        )
    )
    
    # 3. Process
    result = engine.process(input_data)
    
    # 4. Output
    print(json.dumps(result.model_dump(), indent=2))

if __name__ == "__main__":
    main()
