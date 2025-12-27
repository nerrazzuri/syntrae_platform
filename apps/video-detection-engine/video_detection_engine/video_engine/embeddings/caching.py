import hashlib
import json
import logging
from typing import Optional, Dict, Any

from ..core.schemas import InputData, EmbeddingsBundle

logger = logging.getLogger(__name__)

class ContentAddressableCache:
    """
    Implements content-addressable caching for EmbeddingsBundle.
    Key derivation: SHA256(Model_Info + Normalized_Input_Data)
    """
    def __init__(self, ttl_seconds: int = 86400):
        self.ttl_seconds = ttl_seconds
        # In-memory generic store for demo purposes. 
        # In production, replace with Redis client.
        self._store: Dict[str, EmbeddingsBundle] = {} 

    def _compute_hash(self, data: InputData, model_name: str, model_version: str) -> str:
        """
        Generates a deterministic hash for the input.
        """
        # 1. Text Hash
        text_content = (
            data.metadata.caption + 
            "".join([s.text for s in data.audio_transcript.segments]) + 
            "".join([o.text for o in data.ocr_texts])
        )
        
        # 2. Frame Hash (Using IDs/Paths is weak if files change, but assuming immutable artifacts from Phase 1)
        # Ideally we hash pixel bytes, but for speed we hash Storage Paths + Timestamps
        frame_content = "".join(sorted([f"{f.storage_path}:{f.timestamp}" for f in data.sampled_frames]))
        
        # 3. Combine
        raw_key = f"{model_name}:{model_version}:{text_content}:{frame_content}"
        return hashlib.sha256(raw_key.encode('utf-8')).hexdigest()

    def get(self, data: InputData, model_name: str, model_version: str) -> Optional[EmbeddingsBundle]:
        key = self._compute_hash(data, model_name, model_version)
        hit = self._store.get(key)
        
        if hit:
            logger.info(f"Cache HIT for key: {key}")
            # Ensure the cache object knows it was a hit (update the field)
            hit.cache.hit = True
            return hit
        
        logger.debug(f"Cache MISS for key: {key}")
        return None

    def set(self, data: InputData, bundle: EmbeddingsBundle, model_name: str, model_version: str):
        key = self._compute_hash(data, model_name, model_version)
        # Update bundle with cache key for traceability
        bundle.cache.cache_key = key
        # bundle.cache.hit = False # It was a miss when we computed it
        
        self._store[key] = bundle
        logger.debug(f"Cache SET for key: {key}")
