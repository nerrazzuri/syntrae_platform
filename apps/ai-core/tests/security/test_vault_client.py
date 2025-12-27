

def test_env_fallback(monkeypatch):
    monkeypatch.setenv("VAULT_ENABLED", "false")
    from shared.security.secret_manager import secret_manager

    monkeypatch.setenv("SAMPLE_KEY", "abc123")
    assert secret_manager.get("SAMPLE_KEY") == "abc123"


def test_cache_ttl(monkeypatch):
    # Simulate cache with manual remember; since real Vault not present, just ensure no crash
    monkeypatch.setenv("VAULT_ENABLED", "false")
    from shared.security.vault_client import vault_client

    # When disabled, get_secret should return None and not crash
    assert vault_client.get_secret("ANY_KEY") is None
