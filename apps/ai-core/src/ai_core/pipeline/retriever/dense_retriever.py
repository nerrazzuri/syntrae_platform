from typing import List, Dict, Any, Optional

from shared.vector.qdrant import qdrant_service
from ai_core.pipeline.embedding.embedding_service import EmbeddingService


class DenseRetriever:
    def __init__(self):
        # for embedding reuse
        self._emb = EmbeddingService()

    def search_rich(
        self,
        query: str,
        tenant_id: str,
        top_k: int = 8,
        emb: Optional[List[float]] = None,
        user_id: Optional[str] = None,
        role: Optional[str] = None,
        allowed_document_ids: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        e = emb if emb is not None else self._emb.embed_query(query, tenant_id)
        if not e:
            return []
        try:
            results = qdrant_service.search_similar_chunks(
                query_embedding=e,
                tenant_id=tenant_id,
                top_k=top_k,
                user_id=user_id,
                role=role,
                allowed_document_ids=allowed_document_ids,
            )
            rich: List[Dict[str, Any]] = []
            for r in results:
                payload = r.get("payload") or {}
                content = payload.get("content")
                if isinstance(content, str) and content:
                    rich.append(
                        {
                            "content": content,
                            "document_id": payload.get("document_id"),
                            "document_title": payload.get("document_title"),
                            "chunk_index": payload.get("chunk_index"),
                            "score": r.get("score"),
                            "meta": payload.get("metadata", {}),
                        }
                    )
            return rich
        except Exception:
            return []
