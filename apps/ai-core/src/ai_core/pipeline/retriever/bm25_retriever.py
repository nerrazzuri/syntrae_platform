from typing import List, Dict, Any, Tuple, Optional
import time
import threading

from shared.database.models import KnowledgeChunk, Document, KnowledgeBase
from shared.config.tuning import retrieval
from ai_core.pipeline.fusion.bm25 import StandardBM25
from shared.metrics.retrieval_metrics import retrieval_metrics


class BM25Retriever:
    def __init__(self) -> None:
        # In-process per-tenant cache entry:
        # {"ts": float, "corpus": List[str], "text_meta": Dict[str, Dict[str, Any]], "bm25": StandardBM25}
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.Lock()

    def _cache_ttl_s(self) -> int:
        return max(5, int(getattr(retrieval, "bm25_cache_ttl_s", 600)))

    def _is_cache_fresh(self, entry: Optional[Dict[str, Any]], now: float) -> bool:
        if not entry:
            return False
        return (now - float(entry.get("ts", 0))) < self._cache_ttl_s()

    def _build_corpus_entry(
        self,
        db,
        tenant_id: str,
        limit: int,
    ) -> Dict[str, Any]:
        q = (
            db.query(KnowledgeChunk, Document, KnowledgeBase)
            .join(Document, KnowledgeChunk.document_id == Document.id)
            .join(KnowledgeBase, Document.knowledge_base_id == KnowledgeBase.id)
            .filter(KnowledgeBase.tenant_id == tenant_id)
        )
        corpus_cap = min(int(limit), int(getattr(retrieval, "bm25_corpus_limit", 2000)))
        tenant_pairs = q.limit(corpus_cap).all()
        id_to_content: Dict[str, str] = {}
        content_to_row: Dict[str, Dict[str, str]] = {}
        corpus_texts: List[str] = []
        idx_to_id: List[str] = []
        sig_to_id: Dict[str, str] = {}
        text_to_docmeta: Dict[str, Dict[str, Any]] = {}
        for kc, _doc, _kb in tenant_pairs:
            c = getattr(kc, "content", None)
            kid = str(getattr(kc, "id", ""))
            if isinstance(c, str) and c.strip() and kid:
                id_to_content[kid] = c
                idx_to_id.append(kid)
                corpus_texts.append(c)
                sig_to_id[c[:200].lower()] = kid
                try:
                    title = getattr(_doc, "title", None)
                    src = getattr(_doc, "source_url", None)
                    text_to_docmeta[c] = {
                        "document_id": str(getattr(_doc, "id", "")),
                        "title": str(title) if title else "",
                        "source_url": str(src) if src else "",
                    }
                except Exception:
                    pass
                try:
                    meta = getattr(kc, "meta", {}) or {}
                    rowm = meta.get("row") if isinstance(meta, dict) else None
                    if isinstance(rowm, dict) and rowm:
                        content_to_row[c] = {
                            str(k): str(v) for k, v in rowm.items() if v is not None
                        }
                except Exception:
                    pass

        return {
            "ts": time.time(),
            "corpus": corpus_texts,
            "text_meta": text_to_docmeta,
            "bm25": StandardBM25(corpus_texts) if corpus_texts else None,
            "idx_to_id": idx_to_id,
            "id_to_content": id_to_content,
            "content_to_row": content_to_row,
            "sig_to_id": sig_to_id,
        }

    def get_corpus_entry(
        self,
        db,
        tenant_id: str,
        limit: int = 2000,
    ) -> Dict[str, Any]:
        now = time.time()
        with self._lock:
            entry = self._cache.get(tenant_id)
            if self._is_cache_fresh(entry, now):
                retrieval_metrics.inc_bm25_hit(tenant_id)
                return entry or {}

        retrieval_metrics.inc_bm25_miss(tenant_id)
        entry = self._build_corpus_entry(db, tenant_id, limit)
        with self._lock:
            self._cache[tenant_id] = entry
        return entry

    def build_corpus(
        self,
        db,
        tenant_id: str,
        limit: int = 2000,
    ) -> Tuple[
        List[str],
        List[str],
        Dict[str, str],
        Dict[str, Dict[str, str]],
        Dict[str, str],
        Dict[str, Dict[str, Any]],
    ]:
        """Return (corpus_texts, idx_to_id, id_to_content, content_to_row, sig_to_id, text_to_docmeta)."""
        entry = self.get_corpus_entry(db, tenant_id, limit=limit)
        return (
            list(entry.get("corpus", []) or []),
            list(entry.get("idx_to_id", []) or []),
            dict(entry.get("id_to_content", {}) or {}),
            dict(entry.get("content_to_row", {}) or {}),
            dict(entry.get("sig_to_id", {}) or {}),
            dict(entry.get("text_meta", {}) or {}),
        )

    def rank_texts(
        self,
        query: str,
        corpus_texts: List[str],
        top_k: int = 30,
        tenant_id: Optional[str] = None,
    ) -> List[Tuple[int, float]]:
        if not corpus_texts:
            return []
        bm25 = None
        if tenant_id:
            with self._lock:
                entry = self._cache.get(tenant_id)
                if entry and entry.get("corpus") == corpus_texts:
                    bm25 = entry.get("bm25")
        if bm25 is None:
            bm25 = StandardBM25(corpus_texts)
        scores = bm25.score(query)
        ranked = sorted(
            [(i, s) for i, s in enumerate(scores)], key=lambda x: x[1], reverse=True
        )
        return ranked[:top_k]
