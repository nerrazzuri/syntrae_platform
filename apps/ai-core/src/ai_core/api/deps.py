from __future__ import annotations

from fastapi import Depends, HTTPException, Request
import os
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from typing import Dict, Any

from shared.security.jwt import jwt_service
from shared.security.policy import Policy
from ai_core.pipeline.audit_service import write_audit
from shared.database.session import get_db, set_tenant_context


security = HTTPBearer(auto_error=False)


def require(action: str, resource: Dict[str, Any] | None = None):
    async def _inner(
        creds: HTTPAuthorizationCredentials = Depends(security),
        db=Depends(get_db),
        request: Request = None,
    ) -> Dict[str, Any]:
        # Temporary bypass ONLY in dev/local/test and when explicitly enabled (AUTH_BYPASS_ENABLE=1)
        env = os.getenv("ENV", "dev").lower()
        if env in ("dev", "local", "test") and os.getenv("AUTH_ALLOW_ALL", "false").lower() in ("1", "true", "yes") and os.getenv("AUTH_BYPASS_ENABLE", "0") == "1":
            claims = {
                "user_id": "dev-admin",
                "tenant_id": os.getenv(
                    "AUTH_BYPASS_TENANT", "00000000-0000-0000-0000-000000000001"
                ),
                "role": "ADMIN",
            }
            try:
                from shared.logging.pipeline_logger import PipelineLogger

                PipelineLogger(claims["tenant_id"]).emit(
                    {"event": "auth_bypass", "action": action, "service": "ai-core", "severity": "warning"}
                )
            except Exception:
                pass
            return claims
        # Prefer claims attached by middleware (JWT or API key), fallback to JWT header
        try:
            claims = getattr(request.state, "claims", {}) if request else {}
        except Exception:
            claims = {}
        if not claims:
            token = creds.credentials if creds else ""
            claims = jwt_service.verify_token(token) or {}
        if not claims:
            raise HTTPException(status_code=401, detail="Invalid or missing token")
        if not Policy.allowed(claims, action, resource=(resource or {})):
            # Audit denial
            try:
                from shared.logging.pipeline_logger import PipelineLogger

                tenant = str(claims.get("tenant_id", "global"))
                PipelineLogger(tenant).emit(
                    {
                        "audit": {
                            "action": action,
                            "user_id": claims.get("user_id"),
                            "denied": True,
                        }
                    }
                )
                # persistent audit
                corr = (
                    getattr(request.state, "correlation_id", None) if request else None
                )
                write_audit(
                    db=db,
                    tenant_id=tenant,
                    user_id=claims.get("user_id"),
                    action=f"policy.denied:{action}",
                    resource="policy",
                    request_text="",
                    response_text="",
                    success=False,
                    latency_ms=0,
                    category="access",
                    auth_type=getattr(request.state, "auth_type", None)
                    if request
                    else None,
                    api_key_id=getattr(request.state, "api_key_id", None)
                    if request
                    else None,
                    correlation_id=corr,
                )
            except Exception:
                pass
            raise HTTPException(status_code=403, detail="Forbidden")
        # Set DB tenant context for RLS enforcement
        try:
            set_tenant_context(str(claims.get("tenant_id") or ""))
        except Exception:
            pass
        return claims

    return _inner
