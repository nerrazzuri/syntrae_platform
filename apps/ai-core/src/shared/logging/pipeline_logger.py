from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any, Dict


class PipelineLogger:
    def __init__(self, tenant_id: str) -> None:
        self.tenant_id = tenant_id
        # Prefer stdout JSON logging for centralized collectors
        self.service = os.getenv("SERVICE_NAME", "ai-core")
        self.mode = os.getenv("LOG_MODE", "json").lower()

    def emit(self, record: Dict[str, Any]) -> None:
        try:
            record.setdefault("tenant_id", self.tenant_id)
            record.setdefault("timestamp", datetime.utcnow().isoformat())
            record.setdefault("service", self.service)
            if "severity" not in record:
                record["severity"] = "info"
            print(json.dumps(record, ensure_ascii=False), flush=True)
        except Exception:
            # Last resort: swallow to avoid crashing pipelines on logging failures
            pass
