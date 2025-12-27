from typing import List, Dict, Any, Optional, Tuple


class ResultMerger:
    def deduplicate_texts(self, texts: List[str], cap: int = 30) -> List[str]:
        seen = set()
        out: List[str] = []
        for t in texts:
            k = (t or "")[:200].lower()
            if k in seen:
                continue
            seen.add(k)
            out.append(t)
            if len(out) >= cap:
                break
        return out

    def deduplicate_hits(
        self,
        texts: List[str],
        dense_hits: Optional[List[Dict[str, Any]]] = None,
        field_value_hits: Optional[List[Dict[str, Any]]] = None,
        cap: int = 30,
    ) -> List[str]:
        """Dedup by text and by (document_id,row_index,field_name) tuple when available."""
        key_seen: set[Tuple[str, Optional[int], Optional[str]]] = set()
        text_seen: set[str] = set()
        out: List[str] = []

        # Build secondary key map from hits
        tuple_keys: Dict[str, Tuple[str, Optional[int], Optional[str]]] = {}
        for h in dense_hits or []:
            txt = h.get("content") or ""
            doc = h.get("document_id")
            tup = (str(doc), None, None)
            if txt:
                tuple_keys[txt] = tup
        for h in field_value_hits or []:
            txt = h.get("content") or ""
            doc = h.get("document_id")
            ridx = h.get("row_index") if isinstance(h.get("row_index"), int) else None
            fname = (
                h.get("field_name") if isinstance(h.get("field_name"), str) else None
            )
            tup = (str(doc), ridx, fname)
            if txt:
                tuple_keys[txt] = tup

        for t in texts:
            key_txt = (t or "")[:200].lower()
            if key_txt in text_seen:
                continue
            text_seen.add(key_txt)
            tup = tuple_keys.get(t)
            if tup:
                if tup in key_seen:
                    continue
                key_seen.add(tup)
            out.append(t)
            if len(out) >= cap:
                break
        return out
