import os
import shutil
import tempfile
import logging
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from typing import List, Optional

from video_engine.ingest.pipeline import IngestionPipeline
from video_engine.core.schemas import InputData

router = APIRouter()

logger = logging.getLogger(__name__)

# TODO: Make configurable via env or config
STORAGE_ROOT = os.getenv("STORAGE_ROOT", "./storage")

# Ensure storage root exists
os.makedirs(STORAGE_ROOT, exist_ok=True)

pipeline = IngestionPipeline(storage_root=STORAGE_ROOT)

@router.post("/", response_model=InputData)
async def ingest_video(
    file: UploadFile = File(...),
    caption: str = Form(""),
    hashtags: str = Form(""), # Comma separated
    platform: str = Form("unknown")
):
    try:
        # Save uploaded file
        # We need a temporary path or persist it directly.
        # Let's persist directly to a 'uploads' dir
        uploads_dir = os.path.join(STORAGE_ROOT, "uploads")
        os.makedirs(uploads_dir, exist_ok=True)
        
        file_path = os.path.join(uploads_dir, file.filename)
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        logger.info(f"Video uploaded to {file_path}")
            
        # Parse hashtags
        tags_list = [t.strip() for t in hashtags.split(",") if t.strip()]
        
        # Run Pipeline
        input_data = pipeline.process(
            video_path=file_path,
            caption=caption,
            hashtags=tags_list,
            platform=platform
        )
        
        return input_data
        
    except Exception as e:
        logger.error(f"Ingestion failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
