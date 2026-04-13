from unittest.mock import MagicMock

from ai_core.pipeline.llm.llm_client import LLMClient


def test_chat_completion_redacts_pii_before_model_call(monkeypatch):
    client = object.__new__(LLMClient)
    client.client = MagicMock()
    client.model = "gpt-test-model"
    client.temperature = 0
    monkeypatch.setattr(
        "ai_core.pipeline.llm.llm_client.circuit_breaker.allow",
        lambda *args, **kwargs: True,
    )
    monkeypatch.setattr(
        "ai_core.pipeline.llm.llm_client.circuit_breaker.record_success",
        lambda *args, **kwargs: None,
    )

    response = MagicMock()
    response.choices[0].message.content = "ok"
    client.client.chat.completions.create.return_value = response

    out = LLMClient.chat_completion(
        client,
        messages=[{"role": "user", "content": "Email me at alice@example.com"}],
    )

    assert out == "ok"
    kwargs = client.client.chat.completions.create.call_args.kwargs
    assert kwargs["messages"][0]["content"] == "Email me at [REDACTED_EMAIL]"
