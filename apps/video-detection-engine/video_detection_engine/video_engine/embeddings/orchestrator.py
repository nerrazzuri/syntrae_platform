import logging
import time
from typing import Optional, List

from ..core.schemas import (
    InputData, EmbeddingsBundle, EmbeddingConfig, 
    EmbeddingModelMap, EmbeddingModelInfo, 
    FrameEmbedding, TextEmbeddings, 
    PooledEmbeddings, NormalizationInfo, CacheInfo
)
from .loader import ModelLoader
from .caching import ContentAddressableCache
from .pooling import PoolingService

logger = logging.getLogger(__name__)

class EmbeddingOrchestrator:
    def __init__(self, config: Optional[EmbeddingConfig] = None):
        self.config = config or EmbeddingConfig()
        
        # 1. Fail-Fast Model Loading
        self.loader = ModelLoader(self.config.model_name, fail_fast=self.config.fail_fast)
        self.service = self.loader.get_service()
        
        # 2. Initialize Cache
        self.cache = ContentAddressableCache(ttl_seconds=self.config.cache_ttl_seconds) if self.config.cache_enabled else None
        
        # 3. Pooling Service
        self.pooling = PoolingService()
        
        # Metadata for bundle
        self.model_info = EmbeddingModelInfo(
            name=self.config.model_name,
            version="1.0.0", # Mock version
            dim=512
        )

    def process(self, data: InputData) -> EmbeddingsBundle:
        """
        Main pipeline: Input -> Cache Check -> Embedding -> Pooling -> Bundle
        """
        start_time = time.time()
        
        # 1. Cache Lookup
        if self.cache:
            hit = self.cache.get(data, self.model_info.name, self.model_info.version)
            if hit:
                return hit

        # 2. Vision Embedding
        frame_embeddings: List[FrameEmbedding] = []
        # Batching could be optimized here if we had a dedicated batch_embed logic in service
        # For now, we loop (VideoEmbeddingService handles individual calls)
        # Note: If frames are many, we should implement batch logic in Service.
        for frame in data.sampled_frames:
            vec = self.service.embed_image(frame.storage_path)
            frame_embeddings.append(FrameEmbedding(
                frame_id=frame.frame_id,
                timestamp=frame.timestamp,
                vector=vec
            ))
            
        # 3. Text Embedding
        modality_status = {}
        
        # Caption
        caption_text = data.metadata.caption
        modality_status["caption"] = "present" if caption_text else "empty"
        caption_vec = self.service.embed_text(caption_text)
        
        # ASR
        # Check specific semantics: segments empty -> no_audio in this context
        asr_segments = data.audio_transcript.segments
        modality_status["asr"] = "present" if asr_segments else "no_audio"
        asr_text = " ".join([s.text for s in asr_segments])
        asr_vec = self.service.embed_text(asr_text)
        
        # OCR
        ocr_texts_list = data.ocr_texts
        modality_status["ocr"] = "present" if ocr_texts_list else "empty"
        ocr_text = " ".join([o.text for o in ocr_texts_list])
        ocr_vec = self.service.embed_text(ocr_text)
        
        # Vision status
        modality_status["vision_frames"] = "present" if data.sampled_frames else "empty"

        text_embeddings = TextEmbeddings(
            caption_vector=caption_vec,
            asr_vector=asr_vec,
            ocr_vector=ocr_vec
        )

        # 4. Pooling
        pooled = self.pooling.pool_all(frame_embeddings, text_embeddings)

        # 5. Construct Bundle
        bundle = EmbeddingsBundle(
            video_id=data.video_id,
            platform=data.platform,
            embedding_models=EmbeddingModelMap(
                vision=self.model_info,
                text=self.model_info
            ),
            frame_embeddings=frame_embeddings,
            text_embeddings=text_embeddings,
            pooled_embeddings=pooled,
            normalization=NormalizationInfo(
                vision="none", 
                text="none"
            ),
            cache=CacheInfo(
                cache_key="", 
                hit=False
            ),
            modality_status=modality_status
        )
        
        # 6. Cache Save
        if self.cache:
            self.cache.set(data, bundle, self.model_info.name, self.model_info.version)
            
        elapsed = time.time() - start_time
        logger.info(f"Embedding generated for {data.video_id} in {elapsed:.2f}s")
        
        return bundle

    def health(self) -> bool:
        return self.loader.health()
