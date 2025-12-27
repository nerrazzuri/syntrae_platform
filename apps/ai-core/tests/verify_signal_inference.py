import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import MagicMock, patch
import json
import os

# Set env vars for settings
os.environ["JWT_SECRET"] = "test_secret"
os.environ["OPENAI_API_KEY"] = "test_key"
os.environ["SENTRY_DSN"] = ""
os.environ["AI_CORE_INTERNAL_SECRET"] = "super-secret-key"

from ai_core.api.v1.internal import router as internal_router  # noqa: E402
from ai_core.capabilities.signal_inference import SignalInferenceCapability  # noqa: E402


# Create isolated app for testing
@pytest.fixture
def app():
    test_app = FastAPI()
    test_app.include_router(internal_router)
    # Initialize capabilities state
    test_app.state.capabilities = {
        "signal_inference": SignalInferenceCapability(),
    }
    return test_app


@pytest.fixture
def client(app):
    return TestClient(app)


@pytest.fixture
def mock_openai():
    with patch("openai.OpenAI") as mock:
        yield mock


@pytest.fixture
def valid_headers():
    return {
        "X-Internal-Secret": "super-secret-key",
        "X-Tenant-Id": "workspace-123",  # Canonical workspace ID
        "X-Correlation-ID": "test-trace-1",
        "X-User-Id": "user-456",
    }


def test_signal_inference_success(client, mock_openai, valid_headers):
    # Mock LLM response
    mock_instance = mock_openai.return_value
    mock_chat = mock_instance.chat.completions.create.return_value
    mock_chat.choices = [
        MagicMock(
            message=MagicMock(
                content=json.dumps(
                    {
                        "signals": [{"type": "VALUE_EVALUATION", "confidence": 0.8}],
                        "explanation": "Valid signal.",
                    }
                )
            )
        )
    ]

    response = client.post(
        "/v1/internal/signal-inference",
        json={
            "text": "Check this out",
            "existing_signals": [],
            "domain": "test_domain",
        },
        headers=valid_headers,
    )

    if response.status_code != 200:
        print(f"Error: {response.json()}")

    assert response.status_code == 200
    data = response.json()
    assert len(data["inferred_signals"]) == 1
    assert data["inferred_signals"][0]["type"] == "VALUE_EVALUATION"


def test_missing_internal_secret(client):
    response = client.post(
        "/v1/internal/signal-inference",
        json={"text": "Fail me"},
        headers={"X-Tenant-Id": "workspace-123"},
    )
    assert response.status_code == 401
    assert "detail" in response.json()


def test_invalid_internal_secret(client):
    response = client.post(
        "/v1/internal/signal-inference",
        json={"text": "Fail me"},
        headers={"X-Tenant-Id": "workspace-123", "X-Internal-Secret": "wrong-secret"},
    )
    assert response.status_code == 401
    assert "detail" in response.json()


def test_missing_tenant_id(client):
    response = client.post(
        "/v1/internal/signal-inference",
        json={"text": "Fail me"},
        headers={"X-Internal-Secret": "super-secret-key"},
    )
    assert response.status_code == 400
    assert "X-Tenant-Id" in response.json()["detail"]


def test_signal_inference_low_confidence(client, mock_openai, valid_headers):
    mock_instance = mock_openai.return_value
    mock_chat = mock_instance.chat.completions.create.return_value
    mock_chat.choices = [
        MagicMock(
            message=MagicMock(
                content=json.dumps(
                    {
                        "signals": [{"type": "VALUE_EVALUATION", "confidence": 0.3}],
                        "explanation": "Weak signal.",
                    }
                )
            )
        )
    ]

    response = client.post(
        "/v1/internal/signal-inference", json={"text": "Maybe?"}, headers=valid_headers
    )

    assert response.status_code == 200
    data = response.json()
    assert len(data["inferred_signals"]) == 0


def test_signal_inference_internal_error_handling(client, mock_openai, valid_headers):
    mock_instance = mock_openai.return_value
    mock_instance.chat.completions.create.side_effect = Exception("OpenAI Error")

    response = client.post(
        "/v1/internal/signal-inference",
        json={"text": "Crash me"},
        headers=valid_headers,
    )

    assert response.status_code == 500
    assert "OpenAI Error" in response.json()["detail"]
