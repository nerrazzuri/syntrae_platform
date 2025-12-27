from __future__ import annotations

import argparse
import json
import time
from typing import Dict, Any, List, Tuple

from sqlalchemy.orm import Session
from shared.database.session import SessionLocal
from shared.database.models import EvalRun
from shared.metrics.quality_metrics import quality_metrics

from ai_core.pipeline.rag_pipeline import RAGPipeline


def _precision_recall_f1(tp: int, fp: int, fn: int) -> Tuple[float, float, float]:
    p = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    r = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    f1 = (2 * p * r) / (p + r) if (p + r) > 0 else 0.0
    return p, r, f1


def run_suite(
    tenant_id: str, path: str, top_k: int = 5, suite_name: str = "custom"
) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    cases: List[Dict[str, Any]] = (
        data if isinstance(data, list) else data.get("cases", [])
    )
    pipe = RAGPipeline()
    time.time()
    tp = fp = fn = 0
    exact = 0
    lat_sum = 0
    for case in cases:
        q = case.get("query", "")
        expected = str(case.get("answer", "")).strip().lower()
        t1 = time.time()
        out = pipe.answer(q, tenant_id=tenant_id)
        dt = int((time.time() - t1) * 1000)
        lat_sum += dt
        pred = str(out.get("response", "")).strip().lower()
        # simple exact match
        if expected and pred == expected:
            exact += 1
            tp += 1
        else:
            if expected:
                fn += 1
            if pred:
                fp += 1
    avg_latency = int(lat_sum / max(1, len(cases)))
    p, r, f1 = _precision_recall_f1(tp, fp, fn)
    res = {
        "precision": p,
        "recall": r,
        "f1": f1,
        "exact_match": exact / max(1, len(cases)),
        "avg_latency_ms": avg_latency,
        "count": len(cases),
    }
    # Persist
    s: Session = SessionLocal()
    try:
        run = EvalRun(
            tenant_id=tenant_id,
            model="rag_pipeline",
            eval_type="end2end",
            suite_name=suite_name,
            precision_at_k=int(p * 100),
            recall_at_k=int(r * 100),
            f1=int(f1 * 100),
            exact_match=int(res["exact_match"] * 100),
            avg_latency_ms=avg_latency,
            meta={"cases": len(cases)},
        )
        s.add(run)
        s.commit()
    finally:
        s.close()
    # Metrics
    quality_metrics.set_eval(tenant_id, suite_name, p, r, f1)
    return res


def main():
    parser = argparse.ArgumentParser(description="Run multi-domain evaluation suite")
    parser.add_argument("--tenant", required=True)
    parser.add_argument("--path", required=True, help="Path to JSON suite")
    parser.add_argument("--suite", default="custom")
    args = parser.parse_args()
    out = run_suite(args.tenant, args.path, suite_name=args.suite)
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
