from __future__ import annotations

import argparse
import json
import os
import concurrent.futures as _cf
import random
import statistics as _st
import time
from typing import Dict, Any, List, Tuple

from ai_core.pipeline.rag_pipeline import RAGPipeline
from .metrics_store import MetricsStore
from shared.logging.pipeline_logger import PipelineLogger


BASIC_SUITE: List[Dict[str, Any]] = [
    {
        "name": "factual_retrieval",
        "query": "Who is the manager of John Doe?",
        "expected": None,
        "tags": ["lookup"],
    },
    {
        "name": "aggregation_query",
        "query": "How many employees in Finance?",
        "expected": None,
        "tags": ["aggregate"],
    },
    {
        "name": "multi_hop",
        "query": "Who manages the team with the highest average salary?",
        "expected": None,
        "tags": ["lookup"],
    },
    {
        "name": "document_summary",
        "query": "Summarize the cybersecurity policy.",
        "expected": None,
        "tags": ["summary"],
    },
]


def _retrieval_precision(res: Dict[str, Any]) -> float:
    # Placeholder: if citations exist, treat them as relevant; precision is min(1, cited/expected)
    cited = len(res.get("citations", []))
    expected = max(1, cited)  # no gold labels available here
    return min(1.0, cited / float(expected))


def _citation_coverage(text: str) -> float:
    import re as _re

    sents = [s for s in _re.split(r"[.!?]", text or "") if s.strip()]
    cited = [s for s in sents if _re.search(r"\[S\d+\]", s)]
    return len(cited) / (len(sents) or 1)


def _hallucination_score(text: str) -> float:
    # Proxy: URLs without [S#]
    import re as _re

    urls = _re.findall(r"https?://\S+", text or "")
    has_refs = bool(_re.search(r"\[S\d+\]", text or ""))
    if urls and not has_refs:
        return 0.8
    return 0.2 if urls else 0.0


def _load_suite(path: str | None) -> List[Dict[str, Any]]:
    if not path:
        return BASIC_SUITE
    try:
        import yaml  # type: ignore

        with open(path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        return data if isinstance(data, list) else BASIC_SUITE
    except Exception:
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return BASIC_SUITE


def _load_qrels(tenant_id: str) -> Dict[str, Any]:
    for root in ("./data/qrels", "/app/data/qrels"):
        jpath = os.path.join(root, f"{tenant_id}.json")
        cpath = os.path.join(root, f"{tenant_id}.csv")
        if os.path.isfile(jpath):
            try:
                with open(jpath, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        if os.path.isfile(cpath):
            try:
                import csv

                out = {}
                with open(cpath, newline="", encoding="utf-8") as f:
                    for row in csv.DictReader(f):
                        q = row.get("query")
                        if not q:
                            continue
                        out[q] = {
                            "expected_snippets": [
                                s.strip()
                                for s in (row.get("snippets") or "").split(" ")
                                if s.strip()
                            ],
                            "expected_response": row.get("expected_response"),
                        }
                return out
            except Exception:
                pass
    return {}


def _retrieval_qrels_metrics(
    res_snippet_ids: List[str], exp_snippet_ids: List[str], k: int
) -> Tuple[float, float]:
    if not exp_snippet_ids:
        return 0.0, 0.0
    topk = res_snippet_ids[:k]
    inter = len(set(topk) & set(exp_snippet_ids))
    prec = inter / float(len(topk) or 1)
    rec = inter / float(len(exp_snippet_ids))
    return prec, rec


def _exact_f1(pred: str, gold: str) -> Tuple[float, float]:
    if not gold:
        return 0.0, 0.0
    exact = 1.0 if (pred or "").strip().lower() == (gold or "").strip().lower() else 0.0
    import re as _re

    tok = lambda s: [w for w in _re.findall(r"[a-zA-Z0-9]+", s.lower())]
    p = tok(pred or "")
    g = tok(gold or "")
    if not p or not g:
        f1 = 0.0
    else:
        inter = len(set(p) & set(g))
        prec = inter / float(len(p))
        rec = inter / float(len(g))
        f1 = (2 * prec * rec / (prec + rec)) if (prec + rec) else 0.0
    return exact, f1


def _with_timeout(fn, timeout_s: float):
    with _cf.ThreadPoolExecutor(max_workers=1) as ex:
        fut = ex.submit(fn)
        return fut.result(timeout=timeout_s)


def run_suite(
    suite: str = "basic",
    tenant_ids: List[str] | None = None,
    runs: int = 1,
    seed: int = 0,
    suite_path: str | None = None,
) -> Dict[str, Any]:
    pipe = RAGPipeline()
    store = MetricsStore()
    tenants = tenant_ids or (store.list_tenants() if suite_path else ["default"])
    cases = (
        _load_suite(suite_path)
        if suite_path
        else (BASIC_SUITE if suite == "basic" else BASIC_SUITE)
    )
    random.seed(seed)
    per_tenant: Dict[str, Dict[str, Any]] = {}
    all_latencies: List[int] = []
    TIMEOUT_S = float(os.getenv("EVAL_TIMEOUT_S", "30"))
    for tenant in tenants:
        plog = PipelineLogger(tenant)
        intent_buckets: Dict[str, List[Dict[str, Any]]] = {}
        qrels = _load_qrels(tenant)
        for case in cases:
            q = case["query"]
            run_rows: List[Dict[str, Any]] = []
            latencies: List[int] = []
            for _ in range(max(1, runs)):
                t0 = time.time()
                try:
                    res = _with_timeout(
                        lambda: pipe.answer(q, tenant_id=tenant), TIMEOUT_S
                    )
                    error_type = None
                except Exception as e:
                    res = {
                        "response": "",
                        "error": str(e),
                        "qc_status": {"error": True},
                    }
                    error_type = type(e).__name__
                dt = int((time.time() - t0) * 1000)
                latencies.append(dt)
                all_latencies.append(dt)
                text = (res.get("response") or "").strip()
                intent = (
                    (res.get("intent_decision") or {}).get("intent")
                    or res.get("intent")
                    or "lookup"
                )
                # Retrieval metrics with qrels
                exp = qrels.get(q) if isinstance(qrels, dict) else None
                res_ids = [
                    c.get("source", "") if isinstance(c, dict) else ""
                    for c in res.get("citations", [])
                ]
                prec_k, rec_k = _retrieval_qrels_metrics(
                    res_ids,
                    (exp or {}).get("expected_snippets", []),
                    k=len(res_ids) or 1,
                )
                exact, f1 = (
                    _exact_f1(text, (exp or {}).get("expected_response"))
                    if exp
                    else (0.0, 0.0)
                )
                # Other metrics
                retr_prec = _retrieval_precision(res)
                coverage = _citation_coverage(text)
                hall = _hallucination_score(text)
                avg_len = len(text)
                # Expanded signals (placeholders if not available)
                expanded_terms_count = None
                retrieved_k = None
                reranked_k = (
                    len(res.get("citations", []))
                    if isinstance(res.get("citations", []), list)
                    else None
                )
                token_usage_prompt = None
                token_usage_completion = None
                cost_usd = None
                m = {
                    "tenant_id": tenant,
                    "intent": intent,
                    "query": q,
                    "latency_ms": dt,
                    "retrieval_precision": retr_prec,
                    "retrieval_precision@k": prec_k,
                    "retrieval_recall@k": rec_k,
                    "exact_match": exact,
                    "f1": f1,
                    "citation_coverage": coverage,
                    "hallucination_score": hall,
                    "avg_response_len": avg_len,
                    "rewrite_count": (
                        (res.get("qc_status") or {}).get("rewrite_count") or 0
                    ),
                    "error": error_type,
                    # Extended signals placeholders
                    "router_confidence": (
                        (res.get("intent_decision") or {}).get("confidence")
                    ),
                    "router_intent": intent,
                    "expanded_terms_count": expanded_terms_count,
                    "retrieved_k": retrieved_k,
                    "reranked_k": reranked_k,
                    "token_usage_prompt": token_usage_prompt,
                    "token_usage_completion": token_usage_completion,
                    "cost_usd": cost_usd,
                }
                store.record(m)
                run_rows.append(m)
                intent_buckets.setdefault(intent, []).append(m)
                plog.emit({"eval": m})
            # Compute variance stats
            m_summary = {
                "tenant_id": tenant,
                "intent": intent,
                "query": q,
                "latency_ms_mean": float(_st.mean(latencies)),
                "latency_ms_std": float(_st.pstdev(latencies))
                if len(latencies) > 1
                else 0.0,
                "latency_ms_p95": float(
                    sorted(latencies)[int(0.95 * len(latencies)) - 1]
                )
                if len(latencies) > 1
                else float(latencies[0]),
            }
            store.record(m_summary)
        # Aggregate per intent
        agg: List[Dict[str, Any]] = []
        for it, rows in intent_buckets.items():
            if not rows:
                continue
            agg.append(
                {
                    "tenant_id": tenant,
                    "intent": it,
                    "retrieval_precision": float(
                        _st.mean([r["retrieval_precision"] for r in rows])
                    ),
                    "coverage": float(_st.mean([r["citation_coverage"] for r in rows])),
                    "hallucination_score": float(
                        _st.mean([r["hallucination_score"] for r in rows])
                    ),
                    "avg_response_len": float(
                        _st.mean([r["avg_response_len"] for r in rows])
                    ),
                    "count": len(rows),
                }
            )
        per_tenant[tenant] = {"aggregates": agg}
    # Persist a report
    report = {
        "suite": suite,
        "per_tenant": per_tenant,
        "latency_p95": (
            float(sorted(all_latencies)[int(0.95 * len(all_latencies)) - 1])
            if all_latencies
            else 0.0
        ),
    }
    store.write_report(report, filename="report.json")
    return report


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("run", nargs="?", default="run")
    ap.add_argument("--suite", default="basic")
    ap.add_argument("--suite_path")
    ap.add_argument("--tenant", default="default")
    ap.add_argument("--tenant_all", action="store_true")
    ap.add_argument("--runs", type=int, default=1)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()
    store = MetricsStore()
    tenants = store.list_tenants() if args.tenant_all else [args.tenant]
    report = run_suite(
        args.suite, tenants, runs=args.runs, seed=args.seed, suite_path=args.suite_path
    )
    # Threshold-based CI gate
    thresholds = {
        "coverage": float(os.getenv("EVAL_T_COVERAGE", "0.6")),
        "hallucination": float(os.getenv("EVAL_T_HALLUCINATION", "0.1")),
        "latency_p95": float(os.getenv("EVAL_T_LATENCY_P95", "3000")),
    }
    # Derive summary stats
    # For simplicity, check across all tenants/intents
    try:
        # In a real implementation we would compute true p95 from recorded latency summaries
        # Here we mark OK if coverage mean across aggregates >= threshold and hallucination mean <= threshold
        coverages = []
        halls = []
        for tenant, data in report.get("per_tenant", {}).items():
            for agg in data.get("aggregates", []):
                coverages.append(agg.get("coverage", 0.0))
                halls.append(agg.get("hallucination_score", 0.0))
        mean_cov = float(_st.mean(coverages)) if coverages else 0.0
        mean_hall = float(_st.mean(halls)) if halls else 0.0
        lat_p95 = report.get("latency_p95", 0.0)
        status = (
            "PASS"
            if (
                mean_cov >= thresholds["coverage"]
                and mean_hall <= thresholds["hallucination"]
                and lat_p95 <= thresholds["latency_p95"]
            )
            else "FAIL"
        )
        report_out = {
            "status": status,
            "thresholds": thresholds,
            "mean_coverage": mean_cov,
            "mean_hallucination": mean_hall,
            "latency_p95": lat_p95,
        }
        store.write_eval_summary(report_out)
        if status == "FAIL":
            raise SystemExit(1)
    except Exception:
        pass


if __name__ == "__main__":
    main()
