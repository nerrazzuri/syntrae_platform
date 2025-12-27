"""
Tests for AI Core service.
"""
import sys
from pathlib import Path
from fastapi.testclient import TestClient

# Ensure src is in path
ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
sys.path.insert(0, str(SRC))

from ai_core.main import app  # noqa: E402

client = TestClient(app)


def test_health_check():
    """Test health check endpoint."""
    response = client.get("/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["service"] == "ai_core"
    assert "version" in data
    assert "timestamp" in data


def test_query_endpoint():
    """Test query endpoint with valid request."""
    request_data = {
        "tenant_id": "test-tenant",
        "user_id": "test-user",
        "message": "Hello, how are you?",
        "channel": "web",
    }

    response = client.post("/v1/query", json=request_data)
    assert response.status_code == 200
    data = response.json()
    assert "response" in data
    assert "citations" in data
    assert "confidence" in data
    assert "requires_human" in data


def test_query_endpoint_missing_fields():
    """Test query endpoint with missing required fields."""
    request_data = {
        "tenant_id": "test-tenant"
        # Missing message and channel
    }

    response = client.post("/v1/query", json=request_data)
    assert response.status_code == 400


def test_query_endpoint_invalid_channel():
    """Test query endpoint with invalid channel."""
    request_data = {
        "tenant_id": "test-tenant",
        "message": "Hello",
        "channel": "invalid_channel",
    }

    response = client.post("/v1/query", json=request_data)
    # Should still process (no validation on channel in current implementation)
    assert response.status_code == 200
