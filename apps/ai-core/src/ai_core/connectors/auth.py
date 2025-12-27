from __future__ import annotations

from typing import Dict, Any


def get_oauth2_token(tenant_id: str, connector_id: str) -> Dict[str, Any] | None:
    try:
        from shared.security.vault_client import vault_client

        path = f"secret/enterprise/{tenant_id}/connectors/{connector_id}"
        sec = vault_client.read_kv(path)
        if not isinstance(sec, dict):
            return None
        return {
            "access_token": sec.get("access_token"),
            "refresh_token": sec.get("refresh_token"),
            "expires_at": sec.get("expires_at"),
        }
    except Exception:
        return None


def get_api_key(tenant_id: str, connector_id: str) -> str | None:
    try:
        from shared.security.vault_client import vault_client

        path = f"secret/enterprise/{tenant_id}/connectors/{connector_id}"
        sec = vault_client.read_kv(path)
        if not isinstance(sec, dict):
            return None
        return sec.get("api_key")
    except Exception:
        return None


