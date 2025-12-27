from __future__ import annotations

import time
from typing import List, Tuple
import logging
import json

from shared.config.tuning import connectors
from ai_core.connectors.registry import registry
from ai_core.connectors.sharepoint import SharePointConnector
from ai_core.connectors.googledrive import GoogleDriveConnector
from ai_core.connectors.salesforce import SalesforceConnector
from shared.database.session import SessionLocal
from shared.database.models import Tenant
from shared.plans.registry import resolve_plan_label, get_plan
from shared.metrics.connector_metrics import inc_sync


# Register built-in connectors
registry.register(SharePointConnector.name, SharePointConnector)
registry.register(GoogleDriveConnector.name, GoogleDriveConnector)
registry.register(SalesforceConnector.name, SalesforceConnector)


class ConnectorScheduler:
    def __init__(self, tenants: List[str]) -> None:
        self._stop = False
        self._tenants = tenants
        self._interval = connectors.default_interval_s
        # Parse enabled names
        self._names = [
            n.strip() for n in connectors.enabled_names.split(",") if n.strip()
        ]
        self._log = logging.getLogger(__name__)

    def stop(self) -> None:
        self._stop = True

    def loop(self) -> None:
        if not connectors.enabled or not connectors.scheduler_enabled:
            return
        pairs: List[Tuple[str, str]] = []  # (tenant_id, connector_name)
        # Optional manifest JSON mapping {"connectors":[{"name":"sharepoint","tenants":["..."]}, ...]}
        try:
            if connectors.manifest_json_path:
                with open(connectors.manifest_json_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for item in data.get("connectors") or []:
                    nm = str(item.get("name", "")).strip()
                    for tid in item.get("tenants") or []:
                        pairs.append((str(tid), nm))
        except Exception as e:
            self._log.warning(f"Connector manifest load failed: {e}")
            pairs = []
        while not self._stop:
            start = time.time()
            # Build run list
            run_list: List[Tuple[str, str]] = []
            if pairs:
                run_list = pairs
            else:
                # Fallback: dynamic tenant discovery + enabled names
                try:
                    from shared.database.session import SessionLocal
                    from shared.database.models import Tenant

                    s = SessionLocal()
                    try:
                        tids = [str(t.id) for t in s.query(Tenant.id).all()]
                    finally:
                        s.close()
                except Exception as e:
                    self._log.warning(
                        f"Tenant discovery failed: {e}; using provided list"
                    )
                    tids = list(self._tenants)
                for tenant in tids:
                    for name in self._names:
                        run_list.append((tenant, name))

            for tenant, name in run_list:
                cls = registry.get(name)
                if not cls:
                    continue
                try:
                    # Plan enforcement: allowed connectors
                    plan_label = "free"
                    try:
                        s = SessionLocal()
                        try:
                            t = s.query(Tenant).filter(Tenant.id == tenant).first()
                            plan_label = resolve_plan_label(getattr(t, "subscription_tier", None))
                        finally:
                            s.close()
                    except Exception:
                        plan_label = "free"
                    allowed = get_plan(plan_label).get("connectors_allowed", [])
                    if allowed != "*" and name not in allowed:
                        self._log.info(
                            "connector_blocked_by_plan",
                            extra={"tenant_id": tenant, "connector": name, "plan_type": plan_label},
                        )
                        try:
                            inc_sync(plan_label, name, tenant, "blocked")
                        except Exception:
                            pass
                        continue
                    c = cls(tenant)
                    c.run_sync()
                    try:
                        inc_sync(plan_label, name, tenant, "ok")
                    except Exception:
                        pass
                except Exception as e:
                    # Log connector-specific errors with context
                    self._log.exception(
                        f"Connector run failed",
                        extra={
                            "tenant_id": tenant,
                            "connector": name,
                            "module_name": "scheduler",
                            "action": "connector.sync",
                        },
                    )
                    try:
                        inc_sync(plan_label, name, tenant, "error")
                    except Exception:
                        pass
            elapsed = time.time() - start
            sleep_s = max(1.0, self._interval - elapsed)
            time.sleep(sleep_s)
