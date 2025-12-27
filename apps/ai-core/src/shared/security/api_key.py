from __future__ import annotations

import hashlib
from datetime import datetime
from typing import Optional, Dict, Any

from sqlalchemy.orm import Session

from shared.database.models import ApiKey


def _sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


class ApiKeyService:
    """Service for validating and managing tenant-scoped API keys."""

    @staticmethod
    def verify(db: Session, presented_key: str) -> Optional[Dict[str, Any]]:
        """Validate an API key string and return claims-like dict or None."""
        if not presented_key:
            return None
        key_hash = _sha256(presented_key)
        rec: Optional[ApiKey] = (
            db.query(ApiKey).filter(ApiKey.key_hash == key_hash).first()
        )
        if not rec or rec.revoked_at is not None:
            return None
        if rec.expires_at and rec.expires_at < datetime.utcnow():
            return None
        # Update last used lazily (non-critical)
        try:
            rec.last_used_at = datetime.utcnow()
            db.add(rec)
            db.commit()
        except Exception:
            try:
                db.rollback()
            except Exception:
                pass
        role = (
            "ADMIN"
            if any(s.startswith("admin:") for s in (rec.scopes or []))
            else "SERVICE"
        )
        return {
            "user_id": f"api:{rec.id}",
            "api_key_id": str(rec.id),
            "tenant_id": str(rec.tenant_id),
            "role": role,
            "api_key_scopes": rec.scopes or [],
            "auth_type": "api_key",
        }

    @staticmethod
    def hash_key(cleartext_key: str) -> str:
        return _sha256(cleartext_key)
