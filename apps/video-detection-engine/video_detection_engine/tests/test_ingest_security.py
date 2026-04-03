import pytest
from unittest.mock import MagicMock, patch
from video_engine.ingest.pipeline import IngestionPipeline, IngestionError
from video_engine.ingest.validators import ValidationError

def test_pipeline_rejects_oversized_audio():
    # We mock validators to fail
    with patch("video_engine.ingest.validators.MediaValidators.validate_video") as mock_val_vid:
        pipeline = IngestionPipeline("./test_store")
        
        # Test 1: Video Validation Failure
        mock_val_vid.side_effect = ValidationError("Too big")
        
        with pytest.raises(IngestionError) as exc:
            pipeline.process("dummy.mp4")
        
        assert "frame_extraction" not in str(exc.value) # Should act before
        # Actually my code put validate_video inside the big try block, 
        # but it raises IngestionError? 
        # Ah, in process(), the first try/except catches everything.
        # But validate_video raises ValidationError.
        # My except blocks: 
        # except TimeoutError: ...
        # except IngestionError: raise
        # except Exception: catch-all -> IngestionError(stage="unknown")
        
        # Validate_video is called before frame extraction loop.
        # So it falls into catch-all or needs explicit catch.
        # Let's fix pipeline logic to explicitly catch ValidationError -> IngestionError("ingest_validation").

def test_pipeline_timeout_handling():
    # Mock frame extractor to sleep
    pipeline = IngestionPipeline("./test_store")
    
    with patch("video_engine.ingest.validators.MediaValidators.validate_video"):
        with patch.object(pipeline.frame_extractor, 'extract', side_effect=TimeoutError("Timed out")):
             with pytest.raises(IngestionError) as exc:
                 pipeline.process("dummy.mp4")
             assert exc.value.stage == "frame_extraction"
