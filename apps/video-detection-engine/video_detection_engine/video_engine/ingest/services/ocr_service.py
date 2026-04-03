import easyocr
import logging
import os
from typing import List
from video_engine.core.schemas import FrameArtifact, OcrArtifact

logger = logging.getLogger(__name__)

class OcrService:
    def __init__(self, languages: List[str] = ['en'], gpu: bool = False):
        try:
            self.reader = easyocr.Reader(languages, gpu=gpu, verbose=False)
            logger.info(f"Initialized EasyOCR (GPU={gpu})")
        except Exception as e:
            logger.error(f"Failed to initialize EasyOCR: {e}")
            self.reader = None

    def process_frames(self, frames: List[FrameArtifact]) -> List[OcrArtifact]:
        if not self.reader:
            return []

        results = []
        seen_texts = set()

        for frame in frames:
            if not os.path.exists(frame.storage_path):
                continue
            
            try:
                # detail=0 returns just the string list
                texts = self.reader.readtext(frame.storage_path, detail=0)
                
                for text in texts:
                    clean_text = text.strip()
                    if not clean_text: 
                        continue
                    
                    # Deduplication (Simple exact match within video)
                    # In a real system, might want timestamp-based locality (e.g. repeated text is fine if far apart)
                    # For now, strict unique set as per requirement hint "Deduplicate repeated text" 
                    # (though 'Associate OCR text with frame_id' implies keeping instances.
                    # Let's keep instances but maybe filtered by adjacent similarity.
                    # For this implementation: Store ALL instances, but maybe Phase 2 does the dedupe.
                    # Wait, Phase 1 docs said "Deduplicate repeated text".
                    # Let's do simple global dedupe for signal clarity in this MVP.
                    
                    if clean_text in seen_texts:
                        continue
                    
                    seen_texts.add(clean_text)
                    
                    results.append(OcrArtifact(
                        frame_id=frame.frame_id,
                        timestamp=frame.timestamp,
                        text=clean_text
                    ))
            except Exception as e:
                logger.warning(f"OCR failed for frame {frame.frame_id}: {e}")
                
        return results
