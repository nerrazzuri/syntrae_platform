from typing import Literal, Dict

import os
from openai import OpenAI

IntentType = Literal["lookup", "summary", "aggregate", "compare"]


class IntentClassifier:
    def __init__(self) -> None:
        api_key = os.getenv("OPENAI_API_KEY")
        self.client = OpenAI(api_key=api_key) if api_key else None
        # Anchor phrases for simple embedding similarity when API available
        self.anchors: Dict[IntentType, str] = {
            "lookup": "who what where when is are value of",
            "summary": "summarize explain overview summary describe key points",
            "aggregate": "how many count total average sum mean median group by",
            "compare": "compare versus vs difference between contrast side by side",
        }

    def classify(self, query: str) -> IntentType:
        q = (query or "").strip().lower()
        if not q:
            return "lookup"

        # Rule-based quick checks (order matters). Match summary before aggregate to avoid 'sum' in 'summary'.
        import re

        if re.search(r"\b(summarize|summary|overview|explain|describe)\b", q):
            return "summary"
        if re.search(r"\b(compare|versus|vs|difference\s+between|contrast)\b", q):
            return "compare"
        if re.search(r"\b(how\s+many|count|total|average|sum|mean|median)\b", q):
            return "aggregate"

        # Optional embedding similarity to anchors
        try:
            if not self.client:
                return "lookup"
            model = os.getenv("RAG_EMBED_MODEL", "text-embedding-3-large")
            texts = [q] + list(self.anchors.values())
            resp = self.client.embeddings.create(model=model, input=texts)
            vecs = [d.embedding for d in resp.data]
            import numpy as _np

            qv = _np.array(vecs[0])
            sims = {}
            idx = 1
            for intent, _desc in self.anchors.items():
                av = _np.array(vecs[idx])
                idx += 1
                sims[intent] = float(qv @ av) / (
                    float(_np.linalg.norm(qv)) * float(_np.linalg.norm(av)) + 1e-9
                )
            return max(sims, key=sims.get) if sims else "lookup"
        except Exception:
            return "lookup"
