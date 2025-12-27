"""
Pydantic models for AI Core messaging and query API.
"""
from pydantic import BaseModel, Field, constr
from typing import List, Dict, Any, Optional


ChannelName = constr(strip_whitespace=True, to_lower=True)


class Citation(BaseModel):
    source: str
    title: str
    relevance: float = Field(ge=0.0, le=1.0)
    snippet: Optional[str] = None


class QueryRequest(BaseModel):
    # Tenant is derived from authenticated claims; accept alias for backward compatibility
    tenant_id: Optional[str] = Field(None, alias="tenantId")
    user_id: Optional[str] = Field(None, alias="userId")
    channel: ChannelName
    message: str
    context: Dict[str, Any] = Field(default_factory=dict)


class QueryResponse(BaseModel):
    response: str
    citations: List[Citation]
    confidence: float = Field(ge=0.0, le=1.0)
    requires_human: bool = Field(alias="requiresHuman")

    model_config = {
        "populate_by_name": True,
        "str_strip_whitespace": True,
    }


class NormalizedMessage(BaseModel):
    channel: ChannelName
    tenant_id: str
    user_id: str
    text: str
    message_type: str = "text"
    metadata: Dict[str, Any] = Field(default_factory=dict)
