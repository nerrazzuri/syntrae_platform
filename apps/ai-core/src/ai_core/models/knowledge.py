"""
Pydantic models for knowledge base operations.
"""
from pydantic import BaseModel, Field
from typing import Optional, List


class DocumentUploadRequest(BaseModel):
    tenant_id: str = Field(..., alias="tenantId")
    title: str
    content: str
    knowledge_base_id: Optional[str] = Field(None, alias="knowledgeBaseId")
    # Optional document-level RBAC (stored in Document.metadata)
    access: Optional[str] = Field(
        default="tenant", description="Access level: public | tenant | private | restricted"
    )
    owner_user_id: Optional[str] = Field(None, alias="ownerUserId")
    allowed_user_ids: Optional[List[str]] = Field(default=None, alias="allowedUserIds")


class DocumentUploadResponse(BaseModel):
    document_id: str = Field(alias="documentId")
    chunk_count: int = Field(alias="chunkCount")
    status: str
