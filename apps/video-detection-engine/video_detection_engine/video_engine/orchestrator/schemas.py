from enum import Enum
from typing import Optional, Dict, Any, List
from pydantic import BaseModel, Field, UUID4
import datetime
from ..delivery.schemas import DeliveryStatus
from ..core.schemas import DetectionResult # Fix 1

class OrchestrationStatus(str, Enum):
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"
    BLOCKED = "blocked"

class EngagementDecisionType(str, Enum): # Fix 5
    ENGAGE = "engage"
    BLOCK = "block"
    SKIP = "skip"
    UNKNOWN = "unknown"

class DeliveryMode(str, Enum):
    LIVE = "live"
    DRY_RUN = "dry_run"

class VideoContext(BaseModel):
    creator_id: str
    video_caption: str
    language: str = "en"

class EngagementEvent(BaseModel):
    """
    Input Contract (Strict).
    Audit B1: DRY_RUN default is managed by caller config, but input can override.
    """
    trace_id: str # UUID
    tenant_id: str
    platform: str
    video_id: str
    comment_id: str
    comment_text: str
    comment_author_id: str
    video_context: VideoContext
    delivery_mode: DeliveryMode = DeliveryMode.DRY_RUN
    
    # Fix 1: Detection Input (Immutable)
    detection: DetectionResult
    # Fix 2: Auth Token Input (Strict Pass-through)
    rag_access_token: str

class PhaseResult(BaseModel):
    phase_name: str
    status: str # 'success', 'skipped', 'blocked', 'failed'
    output_summary: Dict[str, Any] = Field(default_factory=dict)
    duration_ms: float = 0.0
    error: Optional[str] = None

class OrchestrationResult(BaseModel):
    """
    Run Record (Mandatory Output).
    Immutable record of the entire engagement flow.
    """
    trace_id: str
    tenant_id: str
    platform: str
    comment_id: str
    
    start_time: datetime.datetime
    end_time: Optional[datetime.datetime] = None
    
    final_status: OrchestrationStatus
    delivery_outcome: Optional[DeliveryStatus] = None
    
    # Trace of each phase
    phase_history: List[PhaseResult] = Field(default_factory=list)
    
    # Decisions (Fix 5: Enum)
    decision: EngagementDecisionType = EngagementDecisionType.UNKNOWN
