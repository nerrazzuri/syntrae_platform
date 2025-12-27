"""
Authentication middleware for internal staff and external customers.
"""
from fastapi import HTTPException, status, Header
from typing import Optional, Dict, Any
import requests
import logging

logger = logging.getLogger(__name__)


class SAMLAuth:
    """SAML authentication for internal staff."""

    def __init__(self):
        self.saml_config = {
            "entity_id": "omnichannel-chatbot",
            "sso_url": "https://sso.company.com/saml/login",
            "certificate": "",  # Load from environment or config
        }

    async def authenticate_saml(self, saml_response: Dict[str, Any]) -> Dict[str, Any]:
        """Authenticate SAML response and extract user information."""
        try:
            # Basic SAML response parsing implementation
            # In production, use a proper SAML library like python-saml or saml2

            # For testing purposes, accept any SAML response and extract basic info
            # Real implementation should validate the SAML assertion signature
            user_info = {
                "user_id": saml_response.get(
                    "user_id", "00000000-0000-0000-0000-000000000000"
                ),
                "email": saml_response.get("email", "user@company.com"),
                "user_type": "INTERNAL_STAFF",
                "role": saml_response.get("role", "ADMIN"),
                "tenant_id": saml_response.get(
                    "tenant_id", "00000000-0000-0000-0000-000000000000"
                ),
                "verified": True,
            }

            logger.info(
                f"SAML authentication successful for user: {user_info['email']}"
            )
            return user_info

        except Exception as e:
            logger.error(f"SAML authentication failed: {e}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="SAML authentication failed",
            )


class OAuthAuth:
    """OAuth authentication for external customers."""

    def __init__(self):
        self.google_client_id = "your-google-client-id"
        self.facebook_app_id = "your-facebook-app-id"

    async def authenticate_google(self, token: str) -> Dict[str, Any]:
        """Verify Google OAuth token."""
        try:
            # Verify token with Google
            response = requests.get(
                f"https://oauth2.googleapis.com/tokeninfo?id_token={token}", timeout=10
            )

            if response.status_code == 200:
                token_info = response.json()
                return {
                    "user_id": token_info["sub"],
                    "email": token_info["email"],
                    "user_type": "EXTERNAL_CUSTOMER",
                    "verified": token_info.get("email_verified", False),
                    "tenant_id": None,  # Anonymous until tenant association
                }

            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Google token"
            )

        except Exception as e:
            logger.error(f"Google OAuth authentication failed: {e}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Google authentication failed",
            )

    async def authenticate_facebook(self, token: str) -> Dict[str, Any]:
        """Verify Facebook OAuth token."""
        try:
            # Verify token with Facebook
            response = requests.get(
                f"https://graph.facebook.com/me?access_token={token}&fields=id,email,verified",
                timeout=10,
            )

            if response.status_code == 200:
                user_info = response.json()
                return {
                    "user_id": user_info["id"],
                    "email": user_info.get("email"),
                    "user_type": "EXTERNAL_CUSTOMER",
                    "verified": user_info.get("verified", False),
                    "tenant_id": None,  # Anonymous until tenant association
                }

            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid Facebook token",
            )

        except Exception as e:
            logger.error(f"Facebook OAuth authentication failed: {e}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Facebook authentication failed",
            )


class InternalAuthMiddleware:
    """Authentication middleware for internal staff."""

    def __init__(self):
        self.saml_auth = SAMLAuth()
        self.jwt_service = None  # Will be injected

    async def authenticate_internal_user(
        self, authorization: Optional[str] = Header(None)
    ) -> Dict[str, Any]:
        """Authenticate internal user via JWT or SAML."""
        if not authorization:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authorization header required for internal users",
            )

        try:
            scheme, token = authorization.split()

            if scheme.lower() == "bearer":
                # JWT authentication
                payload = self.jwt_service.verify_token(token)
                if payload and payload.get("user_type") == "INTERNAL_STAFF":
                    return payload
                else:
                    raise HTTPException(
                        status_code=status.HTTP_401_UNAUTHORIZED,
                        detail="Invalid JWT token for internal user",
                    )

            elif scheme.lower() == "saml":
                # SAML authentication
                return await self.saml_auth.authenticate_saml(token)

            else:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Unsupported authentication scheme",
                )

        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authorization header format",
            )
        except Exception as e:
            logger.error(f"Internal authentication failed: {e}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication failed"
            )


class ExternalAuthMiddleware:
    """Authentication middleware for external customers."""

    def __init__(self):
        self.oauth_auth = OAuthAuth()
        self.jwt_service = None  # Will be injected

    async def authenticate_external_user(
        self, authorization: Optional[str] = Header(None)
    ) -> Optional[Dict[str, Any]]:
        """Authenticate external user (optional for anonymous access)."""
        if not authorization:
            return None  # Anonymous access allowed

        try:
            scheme, token = authorization.split()

            if scheme.lower() == "bearer":
                # JWT authentication
                payload = self.jwt_service.verify_token(token)
                if payload and payload.get("user_type") == "EXTERNAL_CUSTOMER":
                    return payload

            elif scheme.lower() == "google":
                return await self.oauth_auth.authenticate_google(token)

            elif scheme.lower() == "facebook":
                # Facebook OAuth implementation
                return await self.oauth_auth.authenticate_facebook(token)

            else:
                logger.warning(f"Unsupported authentication scheme: {scheme}")
                return None

        except ValueError:
            logger.warning("Invalid authorization header format")
            return None
        except Exception as e:
            logger.error(f"External authentication failed: {e}")
            return None

        return None  # Anonymous fallback


# Dependency injection functions
def get_internal_auth_middleware() -> InternalAuthMiddleware:
    """Get internal authentication middleware instance."""
    # This would be properly injected via dependency injection
    middleware = InternalAuthMiddleware()
    # middleware.jwt_service = jwt_service  # Inject JWT service
    return middleware


def get_external_auth_middleware() -> ExternalAuthMiddleware:
    """Get external authentication middleware instance."""
    middleware = ExternalAuthMiddleware()
    # middleware.jwt_service = jwt_service  # Inject JWT service
    return middleware
