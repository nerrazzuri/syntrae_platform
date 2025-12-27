from typing import List, Optional, Dict, Literal, Any
from pydantic import BaseModel, Field

# --- Phase 1: Ingestion Structures (Strict Output Contract) ---

class FrameArtifact(BaseModel):
    frame_id: str
    timestamp: float
    storage_path: str
    width: int
    height: int
    format: Literal["jpg", "png"]

class AudioSegment(BaseModel):
    start: float
    end: float
    text: str

class AudioTranscript(BaseModel):
    language: str
    segments: List[AudioSegment]

class OcrArtifact(BaseModel):
    frame_id: str
    timestamp: float
    text: str

class VideoMetadata(BaseModel):
    caption: str
    hashtags: List[str]



class IngestionErrorDetails(BaseModel):
    stage: str
    message: str
    recoverable: bool

class IngestionError(Exception):
    def __init__(self, stage: str, message: str, recoverable: bool):
        self.stage = stage
        self.message = message
        self.recoverable = recoverable
        super().__init__(f"[{stage}] {message}")
    
    def to_details(self) -> IngestionErrorDetails:
        return IngestionErrorDetails(
            stage=self.stage,
            message=self.message,
            recoverable=self.recoverable
        )

# --- New Modality Schemas (Phase 11+ Ready) ---

class VisualInput(BaseModel):
    """
    Represents visual/video-derived data.
    """
    frames: List[Any] = Field(default_factory=list) # kept generic as requested
    embeddings: Optional[List[List[float]]] = None
    timestamps: Optional[List[float]] = None
    source_fps: Optional[float] = None

class AudioInput(BaseModel):
    """
    Represents audio-derived data.
    """
    transcript: Optional[str] = None
    segments: Optional[List[Dict[str, Any]]] = None
    language: Optional[str] = None

class OcrInput(BaseModel):
    """
    Represents OCR-derived data.
    """
    text: str
    blocks: Optional[List[Dict[str, Any]]] = None
    language: Optional[str] = None

class InputData(BaseModel):
    """
    The canonical data object produced by Phase 1 (Ingestion)
    and consumed by Phase 2 (Inference).
    STRICT CONTRACT.
    """
    video_id: str
    platform: str
    duration_seconds: float
    
    sampled_frames: List[FrameArtifact]
    audio_transcript: AudioTranscript
    ocr_texts: List[OcrArtifact]
    metadata: VideoMetadata

    # New Modalities (Optional, Backward Compatible)
    visual: Optional[VisualInput] = None
    audio: Optional[AudioInput] = None
    ocr: Optional[OcrInput] = None
    
    # Optional error info if partial success is supported (e.g. OCR failed but frames ok)
    # The spec F says "All failures must return {error: ...}". 
    # But usually we throw exception and API handles it.
    # We'll stick to throwing exceptions in Python, but defining the model for API use.

# --- Phase 2: Inference Structures ---

# Allowed Niches
NicheType = Literal[
    "beauty.makeup",
    "beauty.skincare",
    "beauty.hair",
    "fashion.accessory",
    "pets",
    "home.gadget",
    "fitness",
    "food.snack",
    "digital.product",
    "other.consumer"
]

# Allowed Content Types
ContentType = Literal[
    "demo",
    "review",
    "before_after",
    "unboxing",
    "testimonial",
    "tutorial",
    "lifestyle",
    "unknown"
]

class SignalTrace(BaseModel):
    visual: List[str] = Field(default_factory=list)
    audio: List[str] = Field(default_factory=list)
    text_overlay: List[str] = Field(default_factory=list)

class DetectionResult(BaseModel):
    is_commercial_content: bool
    commercial_confidence: float
    niche: NicheType
    sub_niche: str
    content_type: ContentType
    confidence: float
    signals_used: SignalTrace

class ModelConfig(BaseModel):
    """
    Configuration for loading real models.
    """
    embedding_model_name: str = "clip-ViT-B-32"
    commercial_classifier_path: Optional[str] = None
    niche_classifier_path: Optional[str] = None
    content_type_classifier_path: Optional[str] = None

    # Governance Thresholds
    commercial_threshold_low: float = 0.20
    commercial_threshold_high: float = 0.80

# --- Phase 2: Embedding Structures (Strict Contract) ---

class EmbeddingModelInfo(BaseModel):
    name: str
    version: str
    dim: int

class EmbeddingModelMap(BaseModel):
    vision: EmbeddingModelInfo
    text: EmbeddingModelInfo

class FrameEmbedding(BaseModel):
    frame_id: str
    timestamp: float
    vector: List[float]

class TextEmbeddings(BaseModel):
    caption_vector: List[float]
    asr_vector: List[float]
    ocr_vector: List[float]

class PooledEmbeddings(BaseModel):
    vision_pooled: List[float]
    text_pooled: List[float]
    video_pooled: List[float]

class NormalizationInfo(BaseModel):
    vision: Literal["l2", "none"]
    text: Literal["l2", "none"]

class CacheInfo(BaseModel):
    cache_key: str
    hit: bool

class EmbeddingsBundle(BaseModel):
    """
    Strict Output Contract for Phase 2.
    """
    video_id: str
    platform: str
    embedding_models: EmbeddingModelMap
    frame_embeddings: List[FrameEmbedding]
    text_embeddings: TextEmbeddings
    pooled_embeddings: PooledEmbeddings
    normalization: NormalizationInfo
    cache: CacheInfo
    
    # New Phase 2 field: Explicit status
    # Values: "present", "empty", "no_audio"
    modality_status: Dict[str, str]

class EmbeddingConfig(BaseModel):
    """
    Configuration for the Embedding Layer.
    """
    model_name: str = "clip-ViT-B-32"
    batch_size: int = 32
    cache_enabled: bool = True
    cache_ttl_seconds: int = 86400  # 24 hours
    fail_fast: bool = True
