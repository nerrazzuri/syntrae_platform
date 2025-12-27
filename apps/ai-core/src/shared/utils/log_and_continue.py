from __future__ import annotations

import logging

logger = logging.getLogger("ai_core")


def log_and_continue(
    e: Exception,
    context: str,
    tenant_id: str | None = None,
    correlation_id: str | None = None,
    extra: dict | None = None,
) -> None:
    ctx = {"tenant_id": tenant_id, "correlation_id": correlation_id}
    if extra:
        ctx.update(extra)
    try:
        logger.error(
            f"[{context}] Continuing after error: {type(e).__name__} - {e}", extra=ctx
        )
    except Exception:
        # Last resort
        print(f"[{context}] {e}")
