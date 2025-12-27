from enum import Enum
from typing import List, Dict, Optional
from pydantic import BaseModel, Field
import datetime

class SafetyDecisionType(str, Enum):
    ALLOW = "allow"
    DEFER = "defer"
    BLOCK = "block"

class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"

class AppliedLimits(BaseModel):
    author_rate: bool = False
    video_rate: bool = False
    tenant_rate: bool = False
    burst: bool = False

class SafetyCooldown(BaseModel):
    author_seconds: int = 0
    video_seconds: int = 0
    tenant_seconds: int = 0

class SafetyAudit(BaseModel):
    risk_policy_version: str = "1.0"
    computed_at: datetime.datetime = Field(default_factory=datetime.datetime.now)

class SafetyDecision(BaseModel):
    """
    Final output of Phase 7 (Safety Layer).
    Dictates if engagement can proceed NOW.
    """
    final_decision: SafetyDecisionType
    risk_score: float = Field(ge=0.0, le=1.0)
    risk_level: RiskLevel
    applied_limits: AppliedLimits
    cooldown: SafetyCooldown
    reason_codes: List[str] = Field(default_factory=list)
    audit: SafetyAudit

class RiskSignals(BaseModel):
    """
    Dynamic signals for risk computation.
    """
    duplicate_comment_rate: float = 0.0 # 0.0 to 1.0
    author_reply_rate: float = 0.0
    platform_warning_flags: int = 0

class SafetyConfig(BaseModel):
    """
    Tenant configuration for Risk Scoring.
    """
    tenant_id: str
    risk_policy_version: str = "1.0"
    
    # Thresholds
    risk_threshold_low: float = 0.3
    risk_threshold_high: float = 0.7
    
    # Weights for Risk Algo
    weight_author_velocity: float = 0.4
    weight_dummy_factor: float = 0.6 # Placeholder
    
    # Rate Limits (Count / Window)
    limit_author_max: int = 5
    limit_video_max: int = 50
    limit_tenant_max: int = 1000
    limit_burst_max: int = 10
