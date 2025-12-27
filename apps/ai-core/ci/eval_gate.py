from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Dict, Any

from shared.config.tuning import quality_gate
import httpx
from ai_core.evaluator.suite import run_suite


def gate_for_tier(tier: str) -> float:
    t = (tier or "").upper()
    if t == "PRODUCTION" or t == "PROD":
        return float(quality_gate.tier_prod_min_f1)
    if t == "STAGING":
        return float(quality_gate.tier_staging_min_f1)
    return float(quality_gate.min_f1)


def main():
    parser = argparse.ArgumentParser(description="Run eval suites and gate build")
    parser.add_argument("--tenant", required=True)
    parser.add_argument(
        "--suites", required=True, help="Directory containing *.json suites"
    )
    parser.add_argument("--tier", default=os.getenv("CI_TIER", "staging"))
    parser.add_argument("--out", default="ci/artifacts/eval_summary.json")
    args = parser.parse_args()

    suites_dir = Path(args.suites)
    out_dir = Path(args.out).parent
    out_dir.mkdir(parents=True, exist_ok=True)

    summary: Dict[str, Any] = {
        "tenant": args.tenant,
        "tier": args.tier,
        "results": {},
        "passed": True,
    }
    min_f1_required = gate_for_tier(args.tier)
    for suite_file in suites_dir.glob("*.json"):
        res = run_suite(args.tenant, str(suite_file), suite_name=suite_file.stem)
        summary["results"][suite_file.stem] = res
        # Gate conditions
        if quality_gate.enable_gating:
            if res.get("f1", 0.0) < min_f1_required:
                summary["passed"] = False
            if res.get("precision", 0.0) < quality_gate.min_precision:
                summary["passed"] = False
            if res.get("recall", 0.0) < quality_gate.min_recall:
                summary["passed"] = False
            if res.get("avg_latency_ms", 999999) > quality_gate.max_avg_latency_ms:
                summary["passed"] = False

    # Metrics endpoint smoke
    api_base = os.getenv("READINESS_API_BASE")
    if api_base:
        try:
            with httpx.Client(timeout=10) as client:
                r = client.get(api_base.rstrip('/') + "/metrics")
                summary["metrics_ok"] = (r.status_code == 200 and len(r.text) > 0)
                if not summary["metrics_ok"]:
                    summary["passed"] = False
        except Exception:
            summary["metrics_ok"] = False
            summary["passed"] = False

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    if not summary["passed"]:
        print("Quality gate failed:", json.dumps(summary, indent=2))
        sys.exit(1)
    print("Quality gate passed:", json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
