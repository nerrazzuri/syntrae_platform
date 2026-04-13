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
    assert payload["response_hash"] == audit_service._h("Call [REDACTED_PHONE]")
    assert payload["extra"]["raw"] == "Email [REDACTED_EMAIL]"
