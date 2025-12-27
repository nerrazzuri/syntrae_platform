from typing import List, Dict, Any, Optional

from shared.config.tuning import reranker_config


class SchemaBiasReranker:
    def apply(
        self,
        query: str,
        documents: List[str],
        activated_fields: Optional[List[str]] | None = None,
        rich_hits: Optional[List[Dict[str, Any]]] | None = None,
    ) -> List[str]:
        # Lightweight textual bias: move documents that include a matching field label slightly up
        if not documents or not activated_fields:
            return documents
        fields = {str(f).strip().lower().replace(" ", "_") for f in activated_fields}
        factor = getattr(reranker_config, "schema_bias_factor", 1.1)
        scored = []
        for d in documents:
            score = 1.0
            # Heuristic: parse "Field: X |" prefix
            import re

            m = re.match(r"^Field:\s*([^|]+)\|", d)
            if m:
                fdisp = m.group(1).strip().lower().replace(" ", "_")
                if fdisp in fields:
                    score *= factor
            scored.append((d, score))
        scored.sort(key=lambda x: x[1], reverse=True)
        return [d for d, _s in scored]
