import os
import json
import logging
import numpy as np
from moviepy import ColorClip, TextClip, CompositeVideoClip, AudioFileClip, AudioClip
from video_engine.ingest.pipeline import IngestionPipeline
from video_engine.engine import VideoDetectionEngine
from video_engine.core.schemas import ModelConfig

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("verify_ingest")

def create_dummy_video(filename: str):
    logger.info(f"Creating dummy video: {filename}")
    duration = 2.0
    
    # 1. Color Background
    color_clip = ColorClip(size=(640, 480), color=(255, 0, 0), duration=duration)
    
    # 2. Add Text for OCR
    # Note: TextClip requires ImageMagick. If not installed, this might fail.
    # We'll use a try-except to fallback to just color if TextClip fails.
    try:
        from moviepy.video.VideoClip import TextClip 
        # TextClip is tricky on Windows without ImageMagick binary config.
        # Check if we can skip it or mock it. 
        # For simplicity, let's just use ColorClip. OCR will return empty.
        video = color_clip
    except Exception:
        video = color_clip

    # 3. Add Audio (Sine wave)
    make_frame = lambda t: [np.sin(440 * 2 * np.pi * t)] # 440Hz
    audio = AudioClip(make_frame, duration=duration, fps=44100)
    video.audio = audio
    
    video.write_videofile(filename, fps=24, codec="libx264", audio_codec="aac", logger=None)

def main():
    video_path = "test_video.mp4"
    if not os.path.exists(video_path):
        create_dummy_video(video_path)

    # 1. Test Ingestion
    print("\n--- Testing Ingestion ---")
    storage_root = "test_ingest_storage"
    pipeline = IngestionPipeline(storage_root)
    
    input_data = pipeline.process(
        video_path=video_path,
        caption="Review of this amazing product #makeup",
        hashtags=["makeup", "test"],
        platform="verify_script"
    )
    
    print(f"Generated InputData ID: {input_data.video_id}")
    print(f"Frames: {len(input_data.sampled_frames)}")
    print(f"Audio Segments: {len(input_data.audio_transcript.segments)}")
    
    # 2. Test Inference (Phase 2) using Phase 1 Output
    print("\n--- Testing Inference ---")
    config = ModelConfig() # Defaults to CLIP
    engine = VideoDetectionEngine(config)
    
    # Ensure engine can consume the new InputData
    result = engine.process(input_data)
    
    print("\nDetection Result:")
    print(json.dumps(result.model_dump(), indent=2))
    
    print("\nSUCCESS: End-to-End Verification Complete")

if __name__ == "__main__":
    main()
