from typing import List, Dict
import math
from collections import Counter as ColCounter


class StandardBM25:
    def __init__(self, corpus: List[str], k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b
        self.corpus = corpus
        self.doc_count = len(corpus)
        self.doc_len: List[int] = []
        self.doc_freqs: List[ColCounter] = []
        self.vocab: List[str] = []
        self.idf: Dict[str, float] = {}
        self.avgdl = (
            (sum(len(doc.split()) for doc in corpus) / self.doc_count)
            if self.doc_count
            else 0.0
        )
        self._build_stats()

    def _build_stats(self) -> None:
        vocab_set = set()
        for doc in self.corpus:
            words = doc.lower().split()
            self.doc_len.append(len(words))
            cnt = ColCounter(words)
            self.doc_freqs.append(cnt)
            vocab_set.update(cnt.keys())
        self.vocab = list(vocab_set)
        self._compute_idf()

    def _compute_idf(self) -> None:
        N = max(1, self.doc_count)
        for term in self.vocab:
            n = sum(1 for df in self.doc_freqs if term in df)
            self.idf[term] = math.log((N - n + 0.5) / (n + 0.5))

    def score(self, query: str) -> List[float]:
        if not self.corpus:
            return []
        q_terms = query.lower().split()
        scores: List[float] = []
        for i, doc in enumerate(self.corpus):
            dl = self.doc_len[i]
            s = 0.0
            cnt = self.doc_freqs[i]
            for t in q_terms:
                tf = float(cnt.get(t, 0))
                if tf <= 0.0:
                    continue
                idf = self.idf.get(t, 0.0)
                denom = tf + self.k1 * (
                    1 - self.b + self.b * (dl / max(1.0, self.avgdl))
                )
                s += idf * ((tf * (self.k1 + 1)) / max(1e-9, denom))
            scores.append(s)
        return scores
