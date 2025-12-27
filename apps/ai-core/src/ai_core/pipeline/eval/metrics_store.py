from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Dict, Any


class MetricsStore:
    def __init__(self) -> None:
        base = os.getenv("PIPELINE_EVAL_DIR", "/app/logs/eval")
        day = datetime.utcnow().strftime("%Y%m%d")
        self.dir = os.path.join(base, day)
        try:
            os.makedirs(self.dir, exist_ok=True)
        except Exception:
            pass
        self.path = os.path.join(self.dir, "metrics.jsonl")

    def record(self, rec: Dict[str, Any]) -> None:
        try:
            rec.setdefault("timestamp", datetime.utcnow().isoformat())
            with open(self.path, "a", encoding="utf-8") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        except Exception:
            pass

    def write_report(
        self, report: Dict[str, Any], filename: str = "report.json"
    ) -> None:
        try:
            out = os.path.join(self.dir, filename)
            with open(out, "w", encoding="utf-8") as f:
                json.dump(report, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    def write_eval_summary(self, report: Dict[str, Any]) -> None:
        try:
            base = os.getenv("EVAL_REPORT_DIR", "/app/reports")
            day = datetime.utcnow().strftime("%Y%m%d")
            d = os.path.join(base, day)
            os.makedirs(d, exist_ok=True)
            out = os.path.join(d, "eval_summary.json")
            with open(out, "w", encoding="utf-8") as f:
                json.dump(report, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    def list_tenants(self) -> list:
        tenants = []
        for root in ("./data/qrels", "/app/data/qrels"):
            try:
                if os.path.isdir(root):
                    for name in os.listdir(root):
                        if name.endswith(".json") or name.endswith(".csv"):
                            tenants.append(os.path.splitext(name)[0])
            except Exception:
                continue
        return sorted(list(dict.fromkeys(tenants)))
