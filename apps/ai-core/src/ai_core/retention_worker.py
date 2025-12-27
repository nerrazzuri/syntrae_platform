from __future__ import annotations

import time
from typing import Dict
from shared.database.session import SessionLocal
from ai_core.services.retention_service import RetentionService
from shared.config.tuning import retention_defaults as defaults
from shared.utils.log_and_continue import log_and_continue


def loop(stop_flag: Dict[str, bool]) -> None:
    while not stop_flag.get("stop"):
        s = SessionLocal()
        try:
            # For demo: enforce for default tenant only
            svc = RetentionService(s)
            try:
                svc.enforce_for_tenant(
                    "00000000-0000-0000-0000-000000000001"
                )
            except Exception as e:
                log_and_continue(e, "retention.enforce", None, None)
        finally:
            try:
                s.close()
            except Exception:
                pass
        for _ in range(max(60, defaults.enforce_interval_s)):
            if stop_flag.get("stop"):
                break
            time.sleep(1)


