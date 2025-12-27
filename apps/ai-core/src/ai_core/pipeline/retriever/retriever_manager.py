from typing import Dict, Any, List, Optional

from .bm25_retriever import BM25Retriever
from .dense_retriever import DenseRetriever
from .field_value_retriever import FieldValueRetriever
from ai_core.pipeline.embedding.embedding_service import EmbeddingService
from ai_core.pipeline.cache.cache_facade import PipelineCache


class RetrieverManager:
    def __init__(self):
        self.bm25 = BM25Retriever()
        self.dense = DenseRetriever()
        self.fvals = FieldValueRetriever()
        self._emb = EmbeddingService()
        self._cache = PipelineCache()

    def retrieve_all(
        self,
        query: str,
        tenant_id: str,
        db: Any = None,
        preselected_contexts: Optional[List[str]] = None,
        expansion_terms: Optional[List[str]] = None,
        user_id: Optional[str] = None,
        role: Optional[str] = None,
        allowed_document_ids: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        bm25_texts: List[str] = preselected_contexts or []
        dense_hits: List[Dict[str, Any]] = []
        field_value_hits: List[Dict[str, Any]] = []
        content_to_row: Dict[str, Dict[str, str]] = {}

        if db is not None:
            # Build BM25 corpus and rank
            (
                corpus_texts,
                idx_to_id,
                id_to_content,
                content_to_row,
                sig_to_id,
                text_to_docmeta,
            ) = self.bm25.build_corpus(db, tenant_id)
            if corpus_texts:
                ranked = self.bm25.rank_texts(query, corpus_texts, top_k=30)
                ordered_texts = []
                for i, _s in ranked:
                    if 0 <= i < len(corpus_texts):
                        ordered_texts.append(corpus_texts[i])
                bm25_texts = ordered_texts
        else:
            text_to_docmeta = {}

        # Dense and field-value with shared embedding
        cached = self._cache.get(tenant_id, "emb", query)
        if isinstance(cached, list):
            emb = cached
        else:
            # Single-embedding for now; averaging variants can be added inside EmbeddingService later
            emb = self._emb.embed_query(query, tenant_id)
            if emb:
                self._cache.set(tenant_id, "emb", query, emb, ttl=1800)
        dense_hits = self.dense.search_rich(
            query,
            tenant_id,
            top_k=8,
            emb=emb,
            user_id=user_id,
            role=role,
            allowed_document_ids=allowed_document_ids,
        )
        field_value_hits = self.fvals.search_rich(
            query,
            tenant_id,
            top_k=8,
            emb=emb,
            user_id=user_id,
            role=role,
            allowed_document_ids=allowed_document_ids,
        )
        # Cache vector hits to reduce Qdrant load for repeated queries
        if dense_hits:
            self._cache.set(tenant_id, "dense_hits", query, dense_hits, ttl=300)
        if field_value_hits:
            self._cache.set(
                tenant_id, "field_value_hits", query, field_value_hits, ttl=300
            )

        return {
            "bm25_texts": bm25_texts,
            "dense_hits": dense_hits,
            "field_value_hits": field_value_hits,
            "content_to_row": content_to_row,
            "text_to_docmeta": text_to_docmeta,
        }
