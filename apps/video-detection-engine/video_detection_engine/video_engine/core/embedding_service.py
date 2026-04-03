from typing import List, Optional
import numpy as np
import logging
import os
from PIL import Image

from .interfaces import EmbeddingModel

logger = logging.getLogger(__name__)

class VideoEmbeddingService(EmbeddingModel):
    def __init__(self, model_name: str = "clip-ViT-B-32"):
        self.model_name = model_name
        self._model = None
        self._load_model()

    def _load_model(self):
        try:
            from sentence_transformers import SentenceTransformer
            self._model = SentenceTransformer(self.model_name)
            logger.info(f"Loaded embedding model: {self.model_name}")
        except Exception as e:
            logger.error(f"Failed to load sentence-transformers or model: {e}")
            self._model = None

    def embed_text(self, text: str) -> List[float]:
        # Missing modality strategy: Embed fixed token
        if not text or not text.strip():
            target_text = "[EMPTY]" 
        else:
            target_text = text

        if self._model:
            try:
                embedding = self._model.encode(target_text)
                return embedding.tolist()
            except Exception as e:
                # Actual model inference failure
                raise RuntimeError(f"Text embedding inference failed: {e}")
        
        raise RuntimeError("Embedding model not loaded")

    def embed_image(self, image_path: str) -> List[float]:
        if not image_path:
             raise ValueError("Image path required")

        if self._model:
            try:
                # In tests we might use mocks; handle carefully or expect file
                if "mock" in image_path and not os.path.exists(image_path): 
                     # For legacy test compat if real model loaded but mock path used
                     # But we are hardening. Let's try to load.
                     # If file missing, it's an error unless we want "Missing Vision" behavior which usually applies to *list of frames*.
                     # If a single frame path is provided, it must exist.
                     pass

                image = Image.open(image_path)
                embedding = self._model.encode(image)
                return embedding.tolist()
            except Exception as e:
                raise RuntimeError(f"Image embedding failed for {image_path}: {e}")
        
        raise RuntimeError("Embedding model not loaded")
