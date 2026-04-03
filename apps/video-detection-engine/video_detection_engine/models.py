from enum import Enum
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime

# Enums
class VideoDiscoveryDecision(str, Enum):
    ACCEPT = "ACCEPT"
    REJECT = "REJECT"
    SKIP = "SKIP"
    ERROR = "ERROR"  # WF-3.1: System/operational failure

class DiscoveryMode(str, Enum):
    URL = "URL"
    SEARCH = "SEARCH"
    FEED = "FEED"

# Models
class VideoCandidate(BaseModel):
    """
    Represents a potential video found during discovery/search.
    Minimum metadata required for Market Scoring.
    """
    video_url: str
    video_id: Optional[str] = None
    caption: Optional[str] = None
    hashtags: List[str] = Field(default_factory=list)
    author_handle: Optional[str] = None
    platform: str = "tiktok"

class DiscoveredVideo(BaseModel):
    """
    Represents the decision made on a VideoCandidate.
    Payload for persistence (Audit Trail).
    """
    video_id: str
    video_url: str
    platform: str
    market_score: Optional[float] = None  # WF-3.1: None for ERROR decisions
    decision: VideoDiscoveryDecision
    reasons: List[str] = Field(default_factory=list) # Note: API expects 'reasons' mapped to 'decision_reasons'
    market_profile_id: Optional[str] = None
    market_profile_version: Optional[int] = None
    brand_id: str # Required for linking
    automation_run_id: str # Required for linking
    
    # WF-3.1: Failure Semantics & Provenance
    evaluation_performed: bool = True
    error_class: Optional[str] = None
    http_status: Optional[int] = None

class CommentData(BaseModel):
    """
    Standardized extracted comment.
    """
    comment_id: str
    text: str
    author_name: Optional[str] = None
    author_id: Optional[str] = None
    like_count: Optional[int] = 0
    reply_count: Optional[int] = 0
    timestamp: Optional[str] = None
    hashtags: Optional[List[str]] = None
