from __future__ import annotations

from sqlalchemy.orm import Session
import uuid

from shared.database.session import SessionLocal, create_tables
from shared.database.models import Tenant, KnowledgeBase, Document, KnowledgeChunk
from ai_core.pipeline.rag_pipeline import RAGPipeline


def setup_tenant(db: Session) -> str:
    tid = uuid.UUID("00000000-0000-0000-0000-000000000001")
    if not db.get(Tenant, tid):
        db.add(Tenant(id=tid, name="Test", domain="test.local"))
        db.commit()
    kb = KnowledgeBase(tenant_id=tid, name="kb")
    db.add(kb)
    db.commit()
    db.refresh(kb)
    doc = Document(knowledge_base_id=kb.id, title="Doc", content="")
    db.add(doc)
    db.commit()
    db.refresh(doc)
    chunk_texts = [
        "Chapter 1: Overview of project governance.",
        "Chapter 2: Risk management processes.",
        "Record 1: employee_name: Jane Doe\nsalary: 120000\ndepartment: Finance",
    ]
    for i, t in enumerate(chunk_texts):
        db.add(
            KnowledgeChunk(
                document_id=doc.id, content=t, chunk_index=i, embedding=None, meta={}
            )
        )
    db.commit()
    return str(tid)


def test_pipeline_smoke_bm25_only(monkeypatch):
    create_tables()
    db = SessionLocal()
    try:
        tenant_id = setup_tenant(db)
        # Monkeypatch dense retriever path to avoid external calls
        from ai_core.pipeline.retriever import dense_retriever as _dr

        monkeypatch.setattr(
            _dr.DenseRetriever, "search_rich", lambda *args, **kwargs: []
        )
        pipe = RAGPipeline()
        out = pipe.answer("What is covered in chapter 1?", tenant_id=tenant_id, db=db)
        assert isinstance(out, dict)
        assert out.get("response")
    finally:
        db.close()
