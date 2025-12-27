from __future__ import annotations

from typing import Dict, Any


class Policy:
    ROLES = {
        "ADMIN": {"admin:*", "ingestion:*", "retrieval:*", "conversation:*"},
        "WRITER": {
            "ingestion:*",
            "retrieval:read",
            "conversation:write",
            "conversation:read",
        },
        "READER": {"retrieval:read", "conversation:read"},
    }

    @classmethod
    def allowed(
        cls, claims: Dict[str, Any], action: str, resource: Dict[str, Any] | None = None
    ) -> bool:
        if not claims:
            return False
        role = str(claims.get("role", "")).upper()
        perms = cls.ROLES.get(role, set())
        # API key scopes override role matrix if provided
        api_scopes = set(claims.get("api_key_scopes", []) or [])
        if api_scopes:
            perms = perms.union(api_scopes)
        # wildcard match
        parts = action.split(":", 1)
        if action in perms:
            base_ok = True
        else:
            base = f"{parts[0]}:*" if len(parts) > 1 else action
            base_ok = base in perms or "admin:*" in perms
        if not base_ok:
            return False
        # ABAC: restricted classification requires ADMIN
        if (
            resource
            and resource.get("classification") == "restricted"
            and role != "ADMIN"
        ):
            return False
        return True
