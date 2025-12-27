from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Any, Iterable, Optional, List
import time

from shared.cache.redis import redis_cache
from shared.metrics.connector_metrics import connector_metrics
from shared.utils.retry import retry_with_backoff
from shared.utils.circuit_breaker import circuit_breaker
from shared.config.tuning import connectors as connectors_cfg
import logging


@dataclass
class NormalizedRecord:
    tenant_id: str
    source_system: str
    external_id: str
    title: str
    content: str
    owner: Optional[str] = None
    created_at: Optional[str] = None
    modified_at: Optional[str] = None
    classification: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class BaseConnector:
    name: str = "base"

    def __init__(self, tenant_id: str) -> None:
        self.tenant_id = tenant_id

    def _cursor_key(self) -> str:
        return f"connector:{self.name}:{self.tenant_id}:cursor"

    def get_cursor(self) -> Optional[str]:
        return redis_cache.get_tenant_key(self.tenant_id, self._cursor_key())

    def set_cursor(self, value: str) -> None:
        ttl = int(getattr(connectors_cfg, "cursor_ttl_seconds", 7 * 24 * 3600))
        redis_cache.set_tenant_key(self.tenant_id, self._cursor_key(), value, ttl=ttl)

    def list_updates(
        self, since: Optional[str]
    ) -> Iterable[Dict[str, Any]]:  # noqa: D401 (interface)
        """Return iterable of update descriptors from source system."""
        raise NotImplementedError

    def fetch_content(
        self, update: Dict[str, Any]
    ) -> Dict[str, Any]:  # noqa: D401 (interface)
        """Fetch raw content for an update descriptor."""
        raise NotImplementedError

    def normalize_record(
        self, raw: Dict[str, Any]
    ) -> Optional[NormalizedRecord]:  # noqa: D401
        """Map raw content into NormalizedRecord."""
        raise NotImplementedError

    def ingest(self, records: List[NormalizedRecord]) -> int:
        from ai_core.services.document_service import DocumentService
        from shared.database.session import SessionLocal

        s = SessionLocal()
        try:
            ds = DocumentService(s)
            return ds.process_normalized_records(records)
        finally:
            s.close()

    def run_sync(self) -> Dict[str, Any]:
        name = self.name
        tenant = self.tenant_id
        t0 = time.time()
        connector_metrics.inc_sync(name, tenant)
        since = self.get_cursor()

        @retry_with_backoff(f"connector.{name}.list")
        def _list():
            if not circuit_breaker.allow(f"connector_{name}", tenant):
                raise RuntimeError("circuit_open")
            return list(self.list_updates(since))

        try:
            updates = _list()
            circuit_breaker.record_success(f"connector_{name}", tenant)
        except Exception as e:  # noqa: BLE001
            circuit_breaker.record_failure(f"connector_{name}", tenant)
            connector_metrics.inc_fail(name, tenant)
            logging.getLogger(__name__).exception(
                "[connector.list] error", extra={"tenant_id": tenant, "connector": name}
            )
            return {"ok": False, "error": str(e)}

        records: List[NormalizedRecord] = []
        new_cursor = since
        for upd in updates:
            try:
                raw = self.fetch_content(upd)
                rec = self.normalize_record(raw)
                if rec:
                    records.append(rec)
                # advance cursor heuristically
                new_cursor = upd.get("cursor") or new_cursor
            except Exception as e:
                connector_metrics.inc_fail(name, tenant)
                logging.getLogger(__name__).exception(
                    "[connector.fetch_or_normalize] error",
                    extra={"tenant_id": tenant, "connector": name},
                )
                continue

        ingested = 0
        if records:
            ingested = self.ingest(records)
            connector_metrics.inc_records(name, tenant, ingested)
        if new_cursor and new_cursor != since:
            self.set_cursor(new_cursor)
        connector_metrics.observe_duration(name, time.time() - t0)
        return {"ok": True, "updates": len(updates), "ingested": ingested}
