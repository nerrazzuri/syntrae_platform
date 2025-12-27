from __future__ import annotations

from typing import Dict, Any, Iterable, Optional

from .base import BaseConnector, NormalizedRecord
from shared.security.secret_manager import secret_manager


class SalesforceConnector(BaseConnector):
    name = "salesforce"

    def __init__(self, tenant_id: str) -> None:
        super().__init__(tenant_id)
        self._api_key = secret_manager.get(f"SF_TOKEN_{tenant_id}")

    def list_updates(self, since: Optional[str]) -> Iterable[Dict[str, Any]]:
        if not self._api_key:
            return []
        return [{"id": "sf-case-1", "cursor": "v1"}]

    def fetch_content(self, update: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": update["id"],
            "title": "Customer Case: Login Issue",
            "body": "Customer cannot login due to SSO error...",
            "owner": "support@corp.com",
            "created_at": "2025-01-03T00:00:00Z",
            "modified_at": "2025-01-04T00:00:00Z",
        }

    def normalize_record(self, raw: Dict[str, Any]) -> Optional[NormalizedRecord]:
        return NormalizedRecord(
            tenant_id=self.tenant_id,
            source_system=self.name,
            external_id=str(raw.get("id")),
            title=str(raw.get("title", "Untitled")),
            content=str(raw.get("body", "")),
            owner=raw.get("owner"),
            created_at=raw.get("created_at"),
            modified_at=raw.get("modified_at"),
            classification="internal",
            metadata={"connector": self.name},
        )
