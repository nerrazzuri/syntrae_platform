import base64
from shared.crypto.crypto_service import crypto_service


def test_encrypt_decrypt_roundtrip(monkeypatch):
    key = base64.b64encode(b"0" * 32).decode("utf-8")
    monkeypatch.setenv("ENC_KEY_DEFAULT", key)
    blob = crypto_service.encrypt("default", b"hello")
    plain = crypto_service.decrypt("default", blob)
    assert plain == b"hello"
