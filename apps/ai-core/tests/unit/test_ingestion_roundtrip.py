import os
import uuid

from shared.database.session import create_tables, SessionLocal
from shared.database.models import KnowledgeChunk, Document
from ai_core.services.document_service import DocumentService


def test_ingestion_creates_chunks_transactionally():
    os.environ["ENV"] = "test"
    # Ensure tables exist (sqlite default in tests)
    create_tables()

    tenant_id = "00000000-0000-0000-0000-000000000001"
    title = "Test Doc"
    content = "This is a test document. It has multiple sentences. Enough to form chunks."

    db = SessionLocal()
    try:
        svc = DocumentService(db)
        doc_id, chunk_count = svc.process_and_store(
            tenant_id=tenant_id,
            title=title,
            content=content,
            knowledge_base_id=str(uuid.uuid4()),
        )
        assert chunk_count > 0

        # Verify DB persisted chunks atomically
        doc = db.get(Document, uuid.UUID(doc_id))
        assert doc is not None
        chunks = (
            db.query(KnowledgeChunk)
            .filter(KnowledgeChunk.document_id == uuid.UUID(doc_id))
            .all()
        )
        assert len(chunks) == chunk_count
    finally:
        db.close()


