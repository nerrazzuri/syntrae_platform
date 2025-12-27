from typing import List, Dict, Any, Optional

from shared.vector.qdrant import qdrant_service
from ai_core.pipeline.embedding.embedding_service import EmbeddingService


class FieldValueRetriever:
    def __init__(self):
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
            results = qdrant_service.search_field_values(
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
                text = payload.get("content") or ""
                if not isinstance(text, str) or not text:
                    fd = payload.get("field_display") or payload.get("field_name") or ""
                    vr = payload.get("value_raw") or payload.get("value_norm") or ""
                    ridx = payload.get("row_index")
                    sheet = payload.get("sheet") or ""
                    title = payload.get("source_file") or ""
                    parts = [
                        f"Field: {fd}" if fd else None,
                        f"Value: {vr}" if vr else None,
                        f"Record: {int(ridx)+1}" if isinstance(ridx, int) else None,
                        f"Sheet: {sheet}" if sheet else None,
                        f"File: {title}" if title else None,
                    ]
                    text = " | ".join([p for p in parts if p])
                rich.append(
                    {
                        "content": text,
                        "field_name": payload.get("field_name"),
                        "field_display": payload.get("field_display"),
                        "value_raw": payload.get("value_raw"),
                        "value_norm": payload.get("value_norm"),
                        "document_id": payload.get("document_id"),
                        "row_index": payload.get("row_index"),
                        "score": r.get("score"),
                        "meta": payload,
                    }
                )
            return rich
        except Exception:
            return []
