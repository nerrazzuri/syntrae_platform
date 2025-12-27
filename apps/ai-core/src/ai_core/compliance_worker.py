from __future__ import annotations

import time
from typing import Dict
from shared.database.session import SessionLocal
from shared.database.models import Tenant
from shared.config.tuning import compliance as compliance_cfg
from shared.metrics.compliance_metrics import compliance_metrics
from shared.utils.log_and_continue import log_and_continue
from ai_core.services.compliance_reporter import ComplianceReporter


def loop(stop_flag: Dict[str, bool]) -> None:
    reporter = ComplianceReporter()
    while not stop_flag.get("stop"):
        s = SessionLocal()
        try:
            noncompliant = 0
            tenants = []
            try:
                tenants = [str(t.id) for t in s.query(Tenant.id).all()]
            except Exception:
                tenants = ["00000000-0000-0000-0000-000000000001"]
            for tid in tenants:
                try:
                    out = reporter.generate_for_tenant(s, tid)
                    if out.get("summary", {}).get("noncompliant"):
                        noncompliant += 1
                except Exception as e:
                    try:
                        compliance_metrics.inc_failed()
                    except Exception:
                        pass
                    log_and_continue(e, "compliance.generate", tid, None)
            try:
                compliance_metrics.set_noncompliant(noncompliant)
                import time as _t

                compliance_metrics.mark_run(int(_t.time()))
            except Exception:
                pass
        finally:
            try:
                s.close()
            except Exception:
                pass
        # Sleep respecting stop flag
        for _ in range(max(60, int(compliance_cfg.schedule_interval_s))):
            if stop_flag.get("stop"):
                break
            time.sleep(1)


