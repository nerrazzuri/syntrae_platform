from typing import Dict

from shared.config.tuning import retrieval
from shared.vector.qdrant import qdrant_service
from ai_core.pipeline.embedding.embedding_service import EmbeddingService


class SchemaExpander:
    def __init__(self) -> None:
        self._emb = EmbeddingService()

    def expand(self, query: str, tenant_id: str) -> Dict[str, list]:
        try:
            # Compute nearest schema fields via Qdrant and softmax normalize
            emb = self._emb.embed_query(query, tenant_id)
            if not emb:
                return {"expanded_terms": [], "variants": []}
            raw = qdrant_service.search_schema_fields(
                query_embedding=emb,
                tenant_id=tenant_id,
                top_k=max(5, getattr(retrieval, "schema_expansion_top_k", 3)),
            )
            scored = []
            for r in raw:
                payload = r.get("payload") or {}
                nm = payload.get("field_name")
                sc = float(r.get("score") or 0.0)
                if isinstance(nm, str) and nm:
                    scored.append((nm, sc))
            if not scored:
                return {"expanded_terms": [], "variants": []}
            import math as _m

            maxs = max(s for (_n, s) in scored) if scored else 1.0
            exps = [_m.exp((s - maxs)) for (_n, s) in scored]
            ssum = sum(exps) or 1.0
            weights = [(n, e / ssum) for (e, (n, _s)) in zip(exps, scored)]
            weights.sort(key=lambda x: x[1], reverse=True)
            top_k = max(1, int(getattr(retrieval, "schema_expansion_top_k", 3)))
            min_w = float(getattr(retrieval, "schema_expansion_min_weight", 0.08))
            terms = [n for n, w in weights[:top_k] if w >= min_w]
            return {"expanded_terms": terms, "variants": []}
        except Exception:
            return {"expanded_terms": [], "variants": []}
