from ai_core.services.redactor import Redactor


def test_redact_email():
    r = Redactor(mode="redact")
    out = r.sanitize("Contact me at alice@example.com")
    assert "<EMAIL>" in out


def test_hash_phone():
    r = Redactor(mode="hash")
    out = r.sanitize("Call +1-202-555-1234")
    assert "<PHONE:" in out
