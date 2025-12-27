"""
JWT token service with multi-tenant validation and refresh token support.
"""
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
import jwt
from jwt.exceptions import InvalidTokenError, ExpiredSignatureError, DecodeError
import os
import logging

logger = logging.getLogger(__name__)


class JWTService:
    """JWT token service with multi-tenant support."""

    def __init__(self):
        self.secret_key = os.getenv("JWT_SECRET", "")
        self.algorithm = "HS256"
        self.access_token_expire_minutes = int(os.getenv("JWT_EXPIRES_MINUTES", "60"))
        self.refresh_token_expire_days = 7
        self.issuer = os.getenv("JWT_ISSUER", "omnichannel-chatbot")
        self.audience = os.getenv("JWT_AUDIENCE", None)
        # Enforce strong secret in non-dev environments
        env = os.getenv("ENV", "dev").lower()
        if env not in ("dev", "local", "test"):
            if not self.secret_key or len(self.secret_key) < 32:
                raise ValueError("JWT_SECRET too weak; must be >= 32 chars")

    def create_access_token(
        self,
        user_id: str,
        tenant_id: str,
        user_type: str,
        role: str,
        additional_claims: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Create a JWT access token."""
        to_encode = {
            "user_id": user_id,
            "tenant_id": tenant_id,
            "user_type": user_type,
            "role": role,
            "exp": datetime.utcnow()
            + timedelta(minutes=self.access_token_expire_minutes),
            "iat": datetime.utcnow(),
            "type": "access",
            "iss": "omnichannel-chatbot",
        }

        if additional_claims:
            to_encode.update(additional_claims)

        try:
            encoded_jwt = jwt.encode(
                to_encode, self.secret_key, algorithm=self.algorithm
            )
            logger.info(
                f"Created access token for user {user_id} in tenant {tenant_id}"
            )
            return encoded_jwt
        except Exception as e:
            logger.error(f"Failed to create access token: {e}")
            raise

    def create_refresh_token(self, user_id: str, tenant_id: str, user_type: str) -> str:
        """Create a JWT refresh token."""
        to_encode = {
            "user_id": user_id,
            "tenant_id": tenant_id,
            "user_type": user_type,
            "exp": datetime.utcnow() + timedelta(days=self.refresh_token_expire_days),
            "iat": datetime.utcnow(),
            "type": "refresh",
            "iss": "omnichannel-chatbot",
        }

        try:
            encoded_jwt = jwt.encode(
                to_encode, self.secret_key, algorithm=self.algorithm
            )
            logger.info(
                f"Created refresh token for user {user_id} in tenant {tenant_id}"
            )
            return encoded_jwt
        except Exception as e:
            logger.error(f"Failed to create refresh token: {e}")
            raise

    def verify_token(self, token: str) -> Optional[Dict[str, Any]]:
        """Verify and decode a JWT token."""
        try:
            kwargs: Dict[str, Any] = {
                "algorithms": [self.algorithm],
                "issuer": self.issuer,
            }
            if self.audience:
                kwargs["audience"] = self.audience
            payload = jwt.decode(token, self.secret_key, **kwargs)

            # Validate token type
            token_type = payload.get("type")
            if token_type not in ["access", "refresh"]:
                logger.warning(f"Invalid token type: {token_type}")
                return None

            return payload

        except ExpiredSignatureError:
            logger.warning("Token has expired")
            return None
        except InvalidTokenError as e:
            logger.warning(f"Invalid token: {e}")
            return None
        except DecodeError as e:
            logger.warning(f"Failed to decode token: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error verifying token: {e}")
            return None

    def refresh_access_token(self, refresh_token: str) -> Optional[str]:
        """Create a new access token using a refresh token."""
        payload = self.verify_token(refresh_token)

        if not payload or payload.get("type") != "refresh":
            logger.warning("Invalid refresh token provided")
            return None

        # Create new access token with same user info
        return self.create_access_token(
            user_id=payload["user_id"],
            tenant_id=payload["tenant_id"],
            user_type=payload["user_type"],
            role=payload.get("role", "END_USER"),
        )

    def get_tenant_id_from_token(self, token: str) -> Optional[str]:
        """Extract tenant_id from a token without full verification."""
        payload = self.verify_token(token)
        return payload.get("tenant_id") if payload else None

    def get_user_id_from_token(self, token: str) -> Optional[str]:
        """Extract user_id from a token without full verification."""
        payload = self.verify_token(token)
        return payload.get("user_id") if payload else None

    def validate_tenant_access(self, token: str, tenant_id: str) -> bool:
        """Validate that the token has access to the specified tenant."""
        payload = self.verify_token(token)
        if not payload:
            return False

        token_tenant_id = payload.get("tenant_id")
        return token_tenant_id == tenant_id


# Global JWT service instance
jwt_service = JWTService()
