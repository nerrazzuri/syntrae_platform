from __future__ import annotations

import hmac
import hashlib
import time
from typing import Tuple

from shared.security.secret_manager import secret_manager


def _get_signing_secret() -> str:
    # Prefer dedicated file signing secret; fallback to JWT secret
    return secret_manager.get("FILE_SIGNING_SECRET") or secret_manager.require("JWT_SECRET")


def _mac(payload: str, secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def sign_rid(rid: str, tenant_id: str, exp_epoch_s: int) -> str:
    secret = _get_signing_secret()
    payload = f"{rid}|{tenant_id}|{exp_epoch_s}"
    return _mac(payload, secret)


def verify_rid(rid: str, tenant_id: str, exp_epoch_s: int, sig: str) -> Tuple[bool, str]:
    # Expiry
    now = int(time.time())
    if exp_epoch_s <= now:
        return False, "expired"
    secret = _get_signing_secret()
    payload = f"{rid}|{tenant_id}|{exp_epoch_s}"
    expected = _mac(payload, secret)
    if not hmac.compare_digest(expected, sig or ""):
        return False, "invalid"
    return True, "ok"


