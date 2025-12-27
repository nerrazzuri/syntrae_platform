from __future__ import annotations

import hashlib
from typing import Optional, Dict, Any
from sqlalchemy.orm import Session
from shared.database.models import AuditLog
from shared.config.tuning import vault as vault_cfg
from shared.metrics.vault_metrics import vault_metrics


def _h(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def write_audit(
    db: Session,
    tenant_id: str,
    user_id: Optional[str],
    action: str,
    resource: str,
    request_text: str,
    response_text: str,
    success: bool,
    latency_ms: int,
    model: Optional[str] = None,
    token_input: Optional[int] = None,
    token_output: Optional[int] = None,
    category: Optional[str] = None,
    auth_type: Optional[str] = None,
    api_key_id: Optional[str] = None,
    correlation_id: Optional[str] = None,
    classification: Optional[str] = None,
    origin: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> None:
    """Enqueue audit entry; fall back to direct write if queue unavailable."""
    try:
        from shared.queue.retry_queue import retry_queue

        payload = {
            "tenant_id": tenant_id,
            "user_id": user_id,
            "action": action,
            "resource": resource,
            "request_hash": _h(request_text),
            "response_hash": _h(response_text),
            "success": success,
            "latency_ms": latency_ms,
            "model": model,
            "token_input": token_input,
            "token_output": token_output,
            "category": category,
            "auth_type": auth_type,
            "api_key_id": api_key_id,
            "correlation_id": correlation_id,
            "classification": classification,
            "origin": origin,
            "extra": extra or {},
        }
        retry_queue.enqueue("audit_log", tenant_id, payload)
        return
    except Exception as e:
        import logging

        logging.getLogger(__name__).exception(
            "[audit.enqueue] error", extra={"tenant_id": tenant_id, "action": action}
        )

    try:
        rec = AuditLog(
            tenant_id=tenant_id,
            user_id=user_id,
            api_key_id=api_key_id,
            correlation_id=correlation_id,
            auth_type=auth_type,
            category=category,
            action=action,
            resource=resource,
            classification=classification,
            origin=origin,
            request_hash=_h(request_text),
            response_hash=_h(response_text),
            success=success,
            latency_ms=latency_ms,
            model=model,
            token_input=token_input,
            token_output=token_output,
            extra=extra or {},
        )
        db.add(rec)
        db.commit()
    except Exception as e:
        import logging

        logging.getLogger(__name__).exception(
            "[audit.write] error", extra={"tenant_id": tenant_id, "action": action}
        )
        try:
            db.rollback()
        except Exception as e2:
            logging.getLogger(__name__).exception(
                "[audit.rollback] error", extra={"tenant_id": tenant_id}
            )


def write_vault_audit(key_name: str, correlation_id: Optional[str] = None) -> None:
    """Record a vault.fetch event via retry queue (no DB requirement)."""
    try:
        from shared.queue.retry_queue import retry_queue

        payload = {
            "tenant_id": vault_cfg.system_tenant_id,
            "user_id": None,
            "action": "vault.fetch",
            "resource": "vault",
            "request_hash": _h(key_name),
            "response_hash": _h("ok"),
            "success": True,
            "latency_ms": 0,
            "model": None,
            "token_input": None,
            "token_output": None,
            "category": "security",
            "auth_type": None,
            "api_key_id": None,
            "correlation_id": correlation_id,
            "classification": None,
            "origin": None,
            "extra": {},
        }
        retry_queue.enqueue("audit_log", vault_cfg.system_tenant_id, payload)
        vault_metrics.inc_audit_event()
    except Exception:
        # best-effort only
        pass
