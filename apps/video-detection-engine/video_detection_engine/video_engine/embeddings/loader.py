import logging
import numpy as np
from typing import Optional
from ..core.embedding_service import VideoEmbeddingService

logger = logging.getLogger(__name__)

class ModelLoader:
    def __init__(self, model_name: str, fail_fast: bool = True):
        self.model_name = model_name
        self.fail_fast = fail_fast
        self.service: Optional[VideoEmbeddingService] = None
        self._initialize()

    def _initialize(self):
        """
        Loads the model. Fails hard if fail_fast is True and model fails.
        """
        logger.info(f"Initializing ModelLoader for {self.model_name}...")
        try:
            self.service = VideoEmbeddingService(model_name=self.model_name)
            
            # Validation Check: Run a dummy inference
            # If the service falls back to zeros, we might want to detect that if we want stricter enforcement
            # But the requirement says "Never return all zeros vectors as fallback".
            # My current VideoEmbeddingService returns zeros if load fails.
            # So we check internal state.
            
            if self.service._model is None:
                raise RuntimeError("Underlying model failed to load (VideoEmbeddingService._model is None)")
            
            logger.info("Model loaded successfully.")
            
        except Exception as e:
            msg = f"CRITICAL: Failed to load embedding model {self.model_name}: {e}"
            logger.error(msg)
            if self.fail_fast:
                raise RuntimeError(msg)
    
    def get_service(self) -> VideoEmbeddingService:
        if not self.service:
            raise RuntimeError("ModelLoader not initialized")
        return self.service
        
    def health(self) -> bool:
        """
        Readiness probe.
        """
        return self.service is not None and self.service._model is not None
