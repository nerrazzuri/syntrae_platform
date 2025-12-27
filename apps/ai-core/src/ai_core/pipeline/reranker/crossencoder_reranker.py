from typing import List, Dict, Any, Optional

from ai_core.services.reranker_service import AdvancedReranker
from shared.config.tuning import retrieval


class CrossEncoderReranker:
    def __init__(self) -> None:
        self._rr = AdvancedReranker()

    def _build_label_map(
        self,
        documents: List[str],
        rich_hits: Optional[List[Dict[str, Any]]],
        content_to_row: Optional[Dict[str, Dict[str, str]]],
    ) -> Dict[str, str]:
        label_map: Dict[str, str] = {}
        if rich_hits:
            for h in rich_hits:
                txt = (h.get("content") or "").strip()
                meta = h.get("meta") or {}
                row_map = meta.get("row") if isinstance(meta, dict) else None
                if txt and isinstance(row_map, dict) and row_map:
                    # format labeled row
                    parts = []
                    for k, v in row_map.items():
                        if v is None:
                            continue
                        parts.append(f"{k}: {v}")
                    if parts:
                        label_map[txt] = " | ".join(parts)
        if content_to_row:
            for txt, row_map in content_to_row.items():
                if (
                    txt
                    and txt not in label_map
                    and isinstance(row_map, dict)
                    and row_map
                ):
                    parts = []
                    for k, v in row_map.items():
                        if v is None:
                            continue
                        parts.append(f"{k}: {v}")
                    if parts:
                        label_map[txt] = " | ".join(parts)
        return label_map

    def _bi_encoder_scores_from_hits(
        self, documents: List[str], rich_hits: Optional[List[Dict[str, Any]]]
    ) -> List[float]:
        scores = [1.0] * len(documents)
        if not rich_hits:
            return scores
        c2s = {}
        for h in rich_hits:
            c = h.get("content")
            s = h.get("score")
            if isinstance(c, str):
                try:
                    c2s[c] = max(float(s), c2s.get(c, 0.0))
                except Exception:
                    continue
        for i, doc in enumerate(documents):
            if doc in c2s:
                scores[i] = c2s[doc]
        return scores

    def rerank(
        self,
        query: str,
        documents: List[str],
        rich_hits: Optional[List[Dict[str, Any]] | None] = None,
        content_to_row: Optional[Dict[str, Dict[str, str]]] = None,
    ) -> List[str]:
        if not documents:
            return documents
        try:
            label_map = self._build_label_map(documents, rich_hits, content_to_row)
            structured_contexts: List[str] = []
            for c in documents:
                structured_contexts.append(label_map.get(c, c))
            bi_scores = self._bi_encoder_scores_from_hits(documents, rich_hits)
            res = self._rr.multi_stage_reranking(
                query=query,
                documents=structured_contexts,
                bi_encoder_scores=bi_scores,
                top_k=min(retrieval.rerank_top_k, len(structured_contexts)),
            )
            # map back to originals
            if label_map:
                back_map: Dict[str, str] = {v: k for k, v in label_map.items()}
                docs = [back_map.get(d, d) for d in res.documents]
            else:
                docs = res.documents
            return docs
        except Exception:
            return documents
