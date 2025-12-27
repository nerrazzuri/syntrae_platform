import argparse
import sys
import os
import json
import logging
from video_engine.ingest.pipeline import IngestionPipeline

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def main():
    parser = argparse.ArgumentParser(description="Video Ingestion CLI")
    parser.add_argument("video_path", help="Path to the video file")
    parser.add_argument("--caption", default="", help="Video caption metadata")
    parser.add_argument("--hashtags", default="", help="Comma separated hashtags")
    args = parser.parse_args()

    video_path = args.video_path
    if not os.path.exists(video_path):
        logger.error(f"File not found: {video_path}")
        sys.exit(1)

    # Storage Root (Sandboxed)
    # In a real app, this might be configured via env vars
    storage_root = os.path.abspath("ingest_storage")
    if not os.path.exists(storage_root):
        os.makedirs(storage_root)

    try:
        pipeline = IngestionPipeline(storage_root)
        
        hashtags = [h.strip() for h in args.hashtags.split(",")] if args.hashtags else []
        
        result = pipeline.process(
            video_path=video_path,
            caption=args.caption,
            hashtags=hashtags,
            platform="cli_ingest"
        )
        
        # Output JSON
        output_filename = f"{os.path.basename(video_path)}_data.json"
        output_path = os.path.join(os.path.dirname(video_path), output_filename)
        
        with open(output_path, "w") as f:
            f.write(result.model_dump_json(indent=2))
            
        logger.info(f"Ingestion successful. Output saved to: {output_path}")

    except Exception as e:
        logger.error(f"Ingestion failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
