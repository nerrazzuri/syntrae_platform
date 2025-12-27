import joblib
import logging
from typing import Tuple, Dict, List, Optional
import numpy as np

from ..core.schemas import InputData, EmbeddingsBundle
from ..core.interfaces import ICommercialGate, INicheClassifier, IContentTypeClassifier, EmbeddingModel

logger = logging.getLogger(__name__)

class SklearnClassifier:
    """
    Generic adapter for Scikit-Learn (or similar) models.
    """
    def __init__(self, model_path: str, embedding_service: Optional[EmbeddingModel] = None):
        self.embedding_service = embedding_service
        self.model = None
        try:
            self.model = joblib.load(model_path)
            logger.info(f"Loaded Sklearn model from {model_path}")
        except Exception as e:
            logger.error(f"Failed to load model from {model_path}: {e}")

    def _get_features(self, data: InputData, bundle: Optional[EmbeddingsBundle] = None) -> List[float]:
        # Path A: Pre-computed Embeddings (Phase 3)
        if bundle:
            # Concatenate Text + Vision Pooled (Size: 512 + 512 = 1024)
            return bundle.pooled_embeddings.text_pooled + bundle.pooled_embeddings.vision_pooled

        # Path B: Legacy On-the-fly (Phase 2)
        if not self.embedding_service:
            logger.warning("No embedding service and no bundle provided. Returning zeros.")
            return [0.0] * 1024

        # 1. Text Embedding
        # Extract text from new strict schema
        transcript_text = " ".join([seg.text for seg in data.audio_transcript.segments])
        ocr_text = " ".join([ocr.text for ocr in data.ocr_texts])
        
        combined_text = (
            data.metadata.caption + " " + 
            transcript_text + " " + 
            ocr_text
        )
        text_emb = self.embedding_service.embed_text(combined_text)

        # 2. Visual Embedding (Average of frames)
        visual_emb = [0.0] * 512 # Default size for CLIP
        if data.sampled_frames:
             visual_vectors = [
                 self.embedding_service.embed_image(frame.storage_path) 
                 for frame in data.sampled_frames
             ]
             # Average pooling
             if visual_vectors:
                visual_emb = np.mean(visual_vectors, axis=0).tolist()
        
        # 3. Concatenate: [Text, Visual]
        return text_emb + visual_emb

    def predict_proba(self, data: InputData, bundle: Optional[EmbeddingsBundle] = None) -> Dict[str, float]:
        if not self.model:
            return {}
        
        features = [self._get_features(data, bundle)]
        
        # Assume model has classes_ attribute
        # Returns [1, n_classes]
        probs = self.model.predict_proba(features)[0]
        
        return {
            cls: prob for cls, prob in zip(self.model.classes_, probs)
        }

class SklearnCommercialGate(SklearnClassifier, ICommercialGate):
    def assess(self, data: InputData, bundle: Optional[EmbeddingsBundle] = None) -> Tuple[bool, float, Dict[str, List[str]]]:
        if not self.model:
             # Fallback signal if model load failed
            return False, 0.0, {"error": ["model_missing"]}

        probs = self.predict_proba(data, bundle)
        # Assume binary classifier with class "commercial" or 1
        # Checks if key 'commercial' exists or try 1 or True
        score = probs.get("commercial", probs.get(1, probs.get(True, 0.0)))
        
        return score > 0.5, score, {"model": ["sklearn_commercial"]}

class SklearnNicheClassifier(SklearnClassifier, INicheClassifier):
    def classify(self, data: InputData, bundle: Optional[EmbeddingsBundle] = None) -> Tuple[str, str, float, Dict[str, List[str]]]:
        if not self.model:
             return "other.consumer", "unknown", 0.0, {"error": ["model_missing"]}
             
        probs = self.predict_proba(data, bundle)
        # Find max
        best_niche = max(probs, key=probs.get)
        confidence = probs[best_niche]
        
        return best_niche, "generic", confidence, {"model": ["sklearn_niche"]}

class SklearnContentTypeClassifier(SklearnClassifier, IContentTypeClassifier):
    def classify(self, data: InputData, bundle: Optional[EmbeddingsBundle] = None) -> Tuple[str, float, Dict[str, List[str]]]:
         if not self.model:
             return "unknown", 0.0, {"error": ["model_missing"]}
             
         probs = self.predict_proba(data, bundle)
         best_type = max(probs, key=probs.get)
         confidence = probs[best_type]
         
         return best_type, confidence, {"model": ["sklearn_content"]}
