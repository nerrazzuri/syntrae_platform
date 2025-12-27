from typing import List, Dict, Any

from .result_merger import ResultMerger
from .bm25 import StandardBM25
from shared.config.tuning import retrieval


class RankFusion:
    def __init__(self) -> None:
        self._merger = ResultMerger()

    def fuse(
        self,
        bm25_texts: List[str],
        dense_hits: List[Dict[str, Any]],
        field_value_hits: List[Dict[str, Any]],
        query: str,
        tenant_id: str | None = None,
    ) -> List[str]:
        # Build candidate list
        candidates = list(bm25_texts or [])
        vec_map: Dict[str, float] = {}
        for h in dense_hits or []:
            t = h.get("content") or ""
            if not t:
                continue
            vec_map[t] = max(vec_map.get(t, 0.0), float(h.get("score") or 0.0))
            if t not in candidates:
                candidates.append(t)
        fv_map: Dict[str, float] = {}
        for h in field_value_hits or []:
            t = h.get("content") or ""
            if not t:
                continue
            fv_map[t] = max(fv_map.get(t, 0.0), float(h.get("score") or 0.0))
            if t not in candidates:
                candidates.append(t)
        if not candidates:
            return []
        # BM25 ranks
        bm = StandardBM25(candidates)
        bm_scores = bm.score(query)
        ranked_bm = sorted(
            [(s, i) for i, s in enumerate(bm_scores)], key=lambda x: x[0], reverse=True
        )
        bm25_ranking: Dict[str, int] = {}
        for rnk, (_s, idx) in enumerate(ranked_bm):
            bm25_ranking[candidates[idx]] = rnk
        # Dense ranks
        dense_ranking: Dict[str, int] = {}
        if vec_map:
            sorted_dense = sorted(vec_map.items(), key=lambda x: x[1], reverse=True)
            for rnk, (t, _sc) in enumerate(sorted_dense):
                dense_ranking[t] = rnk
        # Field-value ranks
        fv_ranking: Dict[str, int] = {}
        if fv_map:
            sorted_fv = sorted(fv_map.items(), key=lambda x: x[1], reverse=True)
            for rnk, (t, _sc) in enumerate(sorted_fv):
                fv_ranking[t] = rnk
        # RRF weights
        k_rrf = getattr(retrieval, "rrf_k", 60)
        w_bm = getattr(retrieval, "rrf_w_bm25", 0.4)
        w_vec = getattr(retrieval, "rrf_w_dense", 0.5)
        w_fv = getattr(retrieval, "rrf_w_field_values", 0.6)
        # Adaptive per-tenant overrides
        if tenant_id:
            try:
                from shared.database.session import SessionLocal
                from shared.database.models import TenantRerankConfig

                s = SessionLocal()
                try:
                    cfg = (
                        s.query(TenantRerankConfig)
                        .filter(
                            TenantRerankConfig.tenant_id == tenant_id,
                            TenantRerankConfig.active == True,
                        )
                        .order_by(TenantRerankConfig.updated_at.desc())
                        .first()
                    )  # noqa: E712
                    if cfg:
                        w_bm = float(cfg.w_bm25) / 100.0
                        w_vec = float(cfg.w_dense) / 100.0
                        w_fv = float(cfg.w_field_values) / 100.0
                finally:
                    s.close()
            except Exception:
                pass
        scores: Dict[str, float] = {}
        for t in candidates:
            r_bm = bm25_ranking.get(t)
            r_vec = dense_ranking.get(t)
            r_fv = fv_ranking.get(t)
            s = 0.0
            if r_bm is not None:
                s += w_bm * (1.0 / (k_rrf + r_bm))
            if r_vec is not None:
                s += w_vec * (1.0 / (k_rrf + r_vec))
            if r_fv is not None:
                s += w_fv * (1.0 / (k_rrf + r_fv))
            scores[t] = s
        fused = [t for t, _ in sorted(scores.items(), key=lambda x: x[1], reverse=True)]
        # Dedup using hit-aware keys
        return self._merger.deduplicate_hits(
            fused, dense_hits=dense_hits, field_value_hits=field_value_hits, cap=30
        )
