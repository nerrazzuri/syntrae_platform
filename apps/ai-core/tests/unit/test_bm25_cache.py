from types import SimpleNamespace

from ai_core.pipeline.retriever.bm25_retriever import BM25Retriever


class _FakeQuery:
    def __init__(self, rows, tracker):
        self._rows = rows
        self._tracker = tracker

    def join(self, *_args, **_kwargs):
        return self

    def filter(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def all(self):
        self._tracker["all_calls"] += 1
        return self._rows


class _FakeDB:
    def __init__(self, rows, tracker):
        self._rows = rows
        self._tracker = tracker

    def query(self, *_args, **_kwargs):
        self._tracker["query_calls"] += 1
        return _FakeQuery(self._rows, self._tracker)


def test_bm25_corpus_and_index_are_reused_per_tenant():
    tracker = {"query_calls": 0, "all_calls": 0}
    rows = [
        (
            SimpleNamespace(id="kc-1", content="alpha beta", meta={}),
            SimpleNamespace(id="doc-1", title="Doc 1", source_url="https://one"),
            SimpleNamespace(id="kb-1"),
        ),
        (
            SimpleNamespace(id="kc-2", content="beta gamma", meta={}),
            SimpleNamespace(id="doc-2", title="Doc 2", source_url="https://two"),
            SimpleNamespace(id="kb-1"),
        ),
    ]
    db = _FakeDB(rows, tracker)
    retriever = BM25Retriever()

    corpus_a, *_ = retriever.build_corpus(db, "tenant-a")
    cache_entry = retriever._cache["tenant-a"]
    bm25_a = cache_entry["bm25"]

    corpus_b, *_ = retriever.build_corpus(db, "tenant-a")
    ranked = retriever.rank_texts("alpha", corpus_b, tenant_id="tenant-a")

    assert tracker["query_calls"] == 1
    assert tracker["all_calls"] == 1
    assert corpus_a == corpus_b
    assert retriever._cache["tenant-a"]["bm25"] is bm25_a
    assert ranked
    assert ranked[0][0] == 0


def test_bm25_corpus_rebuilds_after_ttl_expiry():
    tracker = {"query_calls": 0, "all_calls": 0}
    rows = [
        (
            SimpleNamespace(id="kc-1", content="alpha beta", meta={}),
            SimpleNamespace(id="doc-1", title="Doc 1", source_url="https://one"),
            SimpleNamespace(id="kb-1"),
        ),
    ]
    db = _FakeDB(rows, tracker)
    retriever = BM25Retriever()

    retriever.build_corpus(db, "tenant-a")
    retriever._cache["tenant-a"]["ts"] -= retriever._cache_ttl_s() + 1
    retriever.build_corpus(db, "tenant-a")

    assert tracker["query_calls"] == 2
    assert tracker["all_calls"] == 2
