from enum import Enum
from typing import List, Dict, Optional
from pydantic import BaseModel, Field

class IntentType(str, Enum):
    PURCHASE = "purchase"
    INQUIRY = "inquiry"
    OBJECTION = "objection"
    COMPARISON = "comparison"
    PRAISE = "praise"
    NEGATIVE = "negative"
    SPAM = "spam"
    UNKNOWN = "unknown"

class CommentData(BaseModel):
    """
    Input data for intent classification.
    """
    id: str
    text: str
    platform: str = "unknown"
    language: str = "en"
    timestamp_relative: Optional[float] = None
    is_reply: bool = False

class IntentResult(BaseModel):
    """
    Output of the Comment Intent Engine.
    Strict contract.
    """
    comment_id: str
    is_actionable: bool
    intent_type: IntentType
    intent_confidence: float = Field(ge=0.0, le=1.0)
    related_niche: str
    signals_used: Dict[str, List[str]]
