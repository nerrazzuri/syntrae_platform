from __future__ import annotations

from typing import Dict
import os
import base64
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import secrets


class CryptoService:
    def __init__(self) -> None:
        self._keys: Dict[str, bytes] = {}

    def _get_key(self, tenant_id: str) -> bytes:
        if tenant_id in self._keys:
            return self._keys[tenant_id]
        raw = os.getenv(f"ENC_KEY_{tenant_id}") or os.getenv("ENC_KEY_DEFAULT")
        if not raw:
            raise RuntimeError("Missing encryption key")
        key = base64.b64decode(raw)
        if len(key) not in (16, 24, 32):
            raise RuntimeError("Invalid AES key size")
        self._keys[tenant_id] = key
        return key

    def encrypt(self, tenant_id: str, plaintext: bytes) -> bytes:
        key = self._get_key(tenant_id)
        aesgcm = AESGCM(key)
        nonce = secrets.token_bytes(12)
        ct = aesgcm.encrypt(nonce, plaintext, None)
        return nonce + ct

    def decrypt(self, tenant_id: str, blob: bytes) -> bytes:
        key = self._get_key(tenant_id)
        aesgcm = AESGCM(key)
        nonce, ct = blob[:12], blob[12:]
        return aesgcm.decrypt(nonce, ct, None)


crypto_service = CryptoService()
