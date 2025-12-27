"""
Internal knowledge service with RBAC enforcement.
"""
from typing import List, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import select
from shared.database.models import Document
from ai_core.models.rbac import has_permission, Permission


class InternalKnowledgeService:
    def __init__(self, db: Session):
        self.db = db

    def list_documents(self, tenant_id: str, role: str) -> List[Dict[str, Any]]:
        if not has_permission(role, Permission.KB_VIEW):
            raise PermissionError("Insufficient permissions to view knowledge base")
        stmt = select(Document).where(Document.knowledge_base_id.isnot(None))
        docs = self.db.execute(stmt).scalars().all()
        return [{"id": str(d.id), "title": d.title, "status": d.status} for d in docs]

    def update_document(
        self, role: str, document_id: str, updates: Dict[str, Any]
    ) -> Dict[str, Any]:
        if not has_permission(role, Permission.KB_EDIT):
            raise PermissionError("Insufficient permissions to edit knowledge base")
        doc = self.db.get(Document, document_id)
        if not doc:
            raise ValueError("Document not found")
        if "title" in updates:
            doc.title = updates["title"]
        if "content" in updates:
            doc.content = updates["content"]
        self.db.add(doc)
        self.db.commit()
        self.db.refresh(doc)
        return {"id": str(doc.id), "title": doc.title, "status": doc.status}
