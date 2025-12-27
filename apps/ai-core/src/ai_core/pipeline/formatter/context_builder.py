from typing import List, Dict, Any


class ContextBuilder:
    def build(self, documents: List[str], cap: int = 30) -> List[str]:
        """Deduplicate and cap contexts, preserving order.

        Mirrors the lightweight dedup used in rag_service to avoid repeated content.
        """
        if not documents:
            return []
        seen = set()
        out: List[str] = []
        for t in documents:
            k = (t or "")[:200].lower()
            if k in seen:
                continue
            seen.add(k)
            out.append(t)
            if len(out) >= cap:
                break
        return out

    def build_structured_from_texts(
        self, texts: List[str], cap: int = 30
    ) -> List[Dict[str, Any]]:
        flat = self.build(texts, cap=cap)
        snippets: List[Dict[str, Any]] = []
        for i, t in enumerate(flat, start=1):
            sid = f"S{i}"
            snippets.append({"id": sid, "source_label": f"chunk_{i}", "text": t})
        return snippets
