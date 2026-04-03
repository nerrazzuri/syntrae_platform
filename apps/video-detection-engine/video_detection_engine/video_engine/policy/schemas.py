from enum import Enum
from typing import List, Dict, Optional
from pydantic import BaseModel, Field

class DecisionType(str, Enum):
    DENY = "deny"
    ALLOW_REPLY = "allow_reply"
    ALLOW_DM = "allow_dm"
    DEFER = "defer"

class AllowedActions(BaseModel):
    can_dm: bool = False
    can_reply: bool = False
    can_include_url: bool = False
    can_include_price: bool = False

class Cooldown(BaseModel):
    author_seconds: int = 0
    video_seconds: int = 0
    tenant_seconds: int = 0

class Constraints(BaseModel):
    max_message_length: int = 200
    tone: str = "neutral"
    language: str = "en"
    no_marketing_claims: bool = True
    cta_type: str = "none" 
    allow_contact_info: bool = False 
    allow_discounts: bool = False 
    can_include_url: bool = False  # Added for A2 + Fix
    can_include_price: bool = False # Added for A2 + Fix

class AuditInfo(BaseModel):
    policy_version: str = "1.0"
    applied_thresholds: Dict[str, float] = Field(default_factory=dict)

class EngagementDecision(BaseModel):
    decision: DecisionType
    decision_confidence: float = Field(ge=0.0, le=1.0)
    allowed_actions: AllowedActions
    cooldown: Cooldown
    constraints: Constraints
    reason_codes: List[str] = Field(default_factory=list)
    audit: AuditInfo
    
class PlatformPolicyProfile(BaseModel):
    platform_id: str
    can_dm: bool = False
    can_reply: bool = False
    can_url: bool = False
    can_price: bool = False
    max_len: int = 200

class EngagementConfig(BaseModel):
    tenant_id: str
    policy_version: str = "1.0"
    quiet_hours_enabled: bool = False
    allow_dm: bool = False
    allow_reply: bool = True
    allow_urls: bool = False
    allow_prices: bool = False
    rate_limit_author_max: int = 5 
    rate_limit_video_max: int = 50 

# --- Phase 7 Consolidate Decision (Audit A1/A2) ---

class EnforcementDecision(BaseModel):
    """
    Master Decision Object (Audit A1/A2).
    """
    decision: DecisionType 
    engagement_type: str 
    risk_level: str 
    allowed_knowledge_refs: List[str] = Field(default_factory=list)
    constraints: Constraints
    reason_codes: List[str] = Field(default_factory=list)
    audit_trace: Dict[str, str] = Field(default_factory=dict)
