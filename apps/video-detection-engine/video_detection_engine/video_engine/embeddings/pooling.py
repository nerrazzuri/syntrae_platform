import numpy as np
from typing import List
from ..core.schemas import PooledEmbeddings, FrameEmbedding, TextEmbeddings

class PoolingService:
    @staticmethod
    def mean_pooling(vectors: List[List[float]], dim: int = 512) -> List[float]:
        """
        Computes mean vector. Returns zero vector if input empty.
        """
        if not vectors:
            return [0.0] * dim
        return np.mean(vectors, axis=0).tolist()

    def pool_all(self, frames: List[FrameEmbedding], text: TextEmbeddings) -> PooledEmbeddings:
        """
        Aggregates frame vectors and text vectors into pooled representations.
        """
        dim = 512 # CLIP dim
        
        # 1. Vision Pooling
        frame_vectors = [f.vector for f in frames]
        vision_pooled = self.mean_pooling(frame_vectors, dim)
        
        # 2. Text Pooling
        # Collect all valid non-zero text vectors
        # A simple heuristic: check if any element is non-zero (or just pool all)
        # Assuming empty text inputs return [EMPTY] token embedding (non-zero), pooling them is consistent.
        # This aligns with Option 1: Include all modalities.
        text_vectors = [text.caption_vector, text.asr_vector, text.ocr_vector]
        text_pooled = self.mean_pooling(text_vectors, dim)
        
        # 3. Video Pooling (Fusion)
        # Simple Mean of Vision + Text
        video_pooled = self.mean_pooling([vision_pooled, text_pooled], dim)
        
        return PooledEmbeddings(
            vision_pooled=vision_pooled,
            text_pooled=text_pooled,
            video_pooled=video_pooled
        )
