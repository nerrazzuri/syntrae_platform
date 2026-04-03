from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field

class ResponseType(str, Enum):
    PRODUCT_INFO = "product_info"
    FAQ = "faq"
    OBJECTION_HANDLING = "objection_handling"
    COMPARISON = "comparison"
    GENERIC_HELP = "generic_help"
    NONE = "none"

class ResponseCandidate(BaseModel):
    """
    A single potential response strategy/content piece.
    """
    response_type: ResponseType
    confidence: float = Field(ge=0.0, le=1.0)
    knowledge_refs: List[str] = Field(default_factory=list) # IDs of RAG docs
    reason_tags: List[str] = Field(default_factory=list) # Traceability tags

class ResponsePlan(BaseModel):
    """
    Final output of Phase 5.
    A prioritized list of response types and content references.
    """
    candidates: List[ResponseCandidate] = Field(default_factory=list)
    selected_language: str = "auto"
