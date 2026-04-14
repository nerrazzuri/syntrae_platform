from ai_core.pipeline import audit_service
import shared.queue.retry_queue as retry_queue_module


def test_write_audit_redacts_request_response_and_extra_before_hash(monkeypatch):
    captured = {}

    def fake_enqueue(job_type, tenant_id, payload, last_error=None):
        captured["job_type"] = job_type
        captured["tenant_id"] = tenant_id
        captured["payload"] = payload

    monkeypatch.setattr(retry_queue_module.retry_queue, "enqueue", fake_enqueue)

    audit_service.write_audit(
        db=None,
        tenant_id="tenant-1",
        user_id="user-1",
        action="generation:answer",
        resource="llm",
        request_text="Contact alice@example.com",
        response_text="Call +1-202-555-1234",
        success=True,
        latency_ms=10,
        extra={"raw": "Email bob@example.com"},
    )

    payload = captured["payload"]
    assert payload["request_hash"] == audit_service._h("Contact [REDACTED_EMAIL]")
    assert payload["response_hash"] == audit_service._h("Call +[REDACTED_PHONE]")
    assert payload["extra"]["raw"] == "Email [REDACTED_EMAIL]"


def test_write_audit_redacts_nested_extra_structures(monkeypatch):
    captured = {}

    def fake_enqueue(job_type, tenant_id, payload, last_error=None):
        captured["payload"] = payload

    monkeypatch.setattr(retry_queue_module.retry_queue, "enqueue", fake_enqueue)

    audit_service.write_audit(
        db=None,
        tenant_id="tenant-1",
        user_id="user-1",
        action="retrieval:rerank",
        resource="knowledge",
        request_text="Call me at +1-202-555-1234",
        response_text="Email alice@example.com",
        success=True,
        latency_ms=10,
        extra={
            "items": [
                {"text": "Reach bob@example.com"},
                "Phone +1-303-555-0000",
            ]
        },
    )

    payload = captured["payload"]
    assert payload["request_hash"] == audit_service._h("Call me at +[REDACTED_PHONE]")
    assert payload["response_hash"] == audit_service._h("Email [REDACTED_EMAIL]")
    assert payload["extra"]["items"][0]["text"] == "Reach [REDACTED_EMAIL]"
    assert payload["extra"]["items"][1] == "Phone +[REDACTED_PHONE]"
