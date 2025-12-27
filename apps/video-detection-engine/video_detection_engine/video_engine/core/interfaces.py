from typing import Protocol, Any, List, Optional
from .schemas import InputData, VideoMetadata, EmbeddingsBundle

class EmbeddingModel(Protocol):
    """Protocol for a model that converts text or images into vector embeddings."""
    def embed_text(self, text: str) -> List[float]:
        ...
        
    def embed_image(self, image_path: str) -> List[float]:
        ...

class ICommercialGate(Protocol):
    """Interface for Step 1: Commercial Content Gate."""
    def assess(self, data: InputData, bundle: Optional[EmbeddingsBundle] = None) -> tuple[bool, float, dict]:
        """
        Returns:
            is_commercial (bool)
            confidence (float)
            signals (dict)
        """
        ...

class INicheClassifier(Protocol):
    """Interface for Step 2: Niche Classification."""
    def classify(self, data: InputData, bundle: Optional[EmbeddingsBundle] = None) -> tuple[str, str, float, dict]:
        """
        Returns:
            niche (str)
            sub_niche (str)
            confidence (float)
            signals (dict)
        """
        ...

class IContentTypeClassifier(Protocol):
    """Interface for Step 3: Content Type Classification."""
    def classify(self, data: InputData, bundle: Optional[EmbeddingsBundle] = None) -> tuple[str, float, dict]:
        """
        Returns:
            content_type (str)
            confidence (float)
            signals (dict)
        """
        ...
