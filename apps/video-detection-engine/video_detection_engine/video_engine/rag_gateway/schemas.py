from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
import datetime

# --- Auth ---

class JWTPayload(BaseModel):
    caller_service: str
    scopes: List[str]
    tenant_id: str
    exp: datetime.datetime

# --- Governance ---

class GovernanceMetadata(BaseModel):
    doc_type: str = "general"
    contains_url: bool = False
    contains_price: bool = False
    language: str = "en"
    compliance_level: str = "safe"
    last_reviewed_at: Optional[datetime.datetime] = None

# --- Retrieve API ---

class SearchResult(BaseModel):
    doc_id: str
    version: str
    score: float
    metadata: GovernanceMetadata

class RetrieveRequest(BaseModel):
    query: str
    filters: Optional[Dict[str, Any]] = None
    top_k: int = 5
    trace_id: str

class RetrieveResponse(BaseModel):
    results: List[SearchResult]

# --- Content API ---

class DocumentContent(BaseModel):
    doc_id: str
    version: str
    content: str

class ContentRequest(BaseModel):
    doc_refs: List[str] # Format: "doc_id:version"
    trace_id: str

class ContentResponse(BaseModel):
    docs: List[DocumentContent]
