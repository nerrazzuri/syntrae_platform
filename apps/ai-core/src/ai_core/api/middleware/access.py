from __future__ import annotations

from typing import Optional, Dict, Any
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from shared.security.jwt import jwt_service
from shared.security.api_key import ApiKeyService
from shared.database.session import SessionLocal


class AccessControlMiddleware(BaseHTTPMiddleware):
    """Authenticate requests via JWT or X-API-Key and attach claims to request.state.

    Authorization decisions are still enforced by route-level dependencies
    (require(action)), but middleware ensures consistent identity and auditing.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        db = SessionLocal()
        claims: Dict[str, Any] = {}
        auth_type: Optional[str] = None
        api_key_id: Optional[str] = None
        try:
            # Prefer JWT bearer
            authz = request.headers.get("authorization") or ""
            if authz.lower().startswith("bearer "):
                token = authz.split(" ", 1)[1]
                c = jwt_service.verify_token(token) or {}
                if c:
                    claims = c
                    auth_type = "jwt"
            # Else try API key
            if not claims:
                key = request.headers.get("x-api-key") or ""
                if key:
                    c = ApiKeyService.verify(db, key) or {}
                    if c:
                        claims = c
                        auth_type = "api_key"
                        api_key_id = c.get("api_key_id")
            request.state.claims = claims or {}
            request.state.auth_type = auth_type or "anonymous"
            request.state.api_key_id = api_key_id
            response = await call_next(request)
            return response
        finally:
            try:
                db.close()
            except Exception:
                pass
