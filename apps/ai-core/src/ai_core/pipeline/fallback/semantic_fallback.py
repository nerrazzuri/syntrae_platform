from typing import Dict, Any, Optional, List


class SemanticFallback:
    def __init__(self, retriever, fusion, cross_reranker, schema_bias=None):
        self.retriever = retriever
        self.fusion = fusion
        self.cross_reranker = cross_reranker
        self.schema_bias = schema_bias

    def run(
        self, query: str, tenant_id: str, db: Any = None
    ) -> Optional[Dict[str, Any]]:
        """Dense-only retry path: retrieve dense + field_values with higher top_k, fuse and rerank.

        Returns a payload-like dict if improved; caller decides whether to use.
        """
        try:
            retrieved = self.retriever.retrieve_all(
                query=query, tenant_id=tenant_id, db=db
            )
            fused = self.fusion.fuse(
                bm25_texts=[],  # skip BM25
                dense_hits=retrieved.get("dense_hits", []),
                field_value_hits=retrieved.get("field_value_hits", []),
                query=query,
            )
            reranked_docs: List[str] = self.cross_reranker.rerank(
                query, fused, rich_hits=retrieved.get("dense_hits", [])
            )
            # Only return a fallback when we actually have content; otherwise signal no-op
            if not reranked_docs or not (reranked_docs[0] or "").strip():
                return None
            return {
                "response": reranked_docs[0],
                "citations": [],
                "confidence": 0.0,
                "requiresHuman": False,
            }
        except Exception:
            return None
