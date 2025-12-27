import pytest
from video_engine.core.schemas import (
    InputData, VideoMetadata, DetectionResult, 
    FrameArtifact, AudioTranscript, AudioSegment, OcrArtifact
)
from video_engine.engine import VideoDetectionEngine

@pytest.fixture
def engine():
    return VideoDetectionEngine()

@pytest.fixture
def commercial_input():
    return InputData(
        video_id="test_comm_1",
        platform="tiktok",
        duration_seconds=10.0,
        sampled_frames=[
            FrameArtifact(
                frame_id="f1", timestamp=0.0, storage_path="path/to/frame.jpg", 
                width=100, height=100, format="jpg"
            )
        ],
        audio_transcript=AudioTranscript(
            language="en",
            segments=[
                AudioSegment(start=0.0, end=1.0, text="Buy this product now")
            ]
        ),
        ocr_texts=[
             OcrArtifact(frame_id="f1", timestamp=0.0, text="50% OFF SALE")
        ],
        metadata=VideoMetadata(
            caption="Best deal ever #promo",
            hashtags=["promo", "deal"]
        )
    )

@pytest.fixture
def non_commercial_input():
    return InputData(
        video_id="test_non_comm_1",
        platform="tiktok",
        duration_seconds=10.0,
        sampled_frames=[],
        audio_transcript=AudioTranscript(
            language="en",
            segments=[
                AudioSegment(start=0.0, end=1.0, text="Just a vlog about my day")
            ]
        ),
        ocr_texts=[],
        metadata=VideoMetadata(
            caption="My morning routine",
            hashtags=["vlog", "daily"]
        )
    )

def test_commercial_detection(engine, commercial_input):
    """Test that commercial input is detected as commercial."""
    result = engine.process(commercial_input)
    assert result.is_commercial_content is True
    assert result.commercial_confidence > 0.0
    # Heuristics should pick up 'Buy' and 'SALE'

def test_non_commercial_detection(engine, non_commercial_input):
    """Test that non-commercial input is detected as such."""
    result = engine.process(non_commercial_input)
    assert result.is_commercial_content is False
    assert result.commercial_confidence < 0.5 

def test_minimal_input(engine):
    """Test processing with minimal empty input."""
    minimal_data = InputData(
        video_id="minimal_1",
        platform="unknown",
        duration_seconds=0.0,
        sampled_frames=[],
        audio_transcript=AudioTranscript(language="unknown", segments=[]),
        ocr_texts=[],
        metadata=VideoMetadata(caption="", hashtags=[])
    )
    result = engine.process(minimal_data)
    assert isinstance(result, DetectionResult)
    assert result.is_commercial_content is False
