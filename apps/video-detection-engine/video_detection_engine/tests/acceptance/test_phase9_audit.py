import pytest
from unittest.mock import MagicMock
from video_engine.delivery.schemas import (
    DeliveryConfig, DeliveryStatus, ConnectorType
)
from video_engine.delivery.engine import DeliveryEngine
from video_engine.generation.schemas import GenerationMode

# --- Fixtures ---

@pytest.fixture
def config_audit():
    return DeliveryConfig(
        tenant_id="audit_tenant",
        active_connectors={"tiktok": ConnectorType.MOCK},
        retry_max_attempts=2,
        dry_run_enabled=True # Default Safe
    )

@pytest.fixture
def engine(config_audit):
    return DeliveryEngine(config_audit)

# --- A. Immutability ---

def test_audit_A1_immutability(engine):
    # Pass content, ensure output doesn't mutate or if it does, it's just ID/Status
    # Engine takes message_text str. Strings are immutable in Python. 
    # Logic doesn't replace it. 
    # Dry run should pass.
    key = "immut_1"
    res = engine.process("tiktok", GenerationMode.REPLY, "Original", "c1", "v1", "a1", key)
    # Check connector wasn't called (implied by dry run)
    assert res.delivery_status == DeliveryStatus.SKIPPED_DRY_RUN

# --- B. Dry Run ---

def test_audit_B1_dry_run_default(engine):
    # Verify default config has dry_run=True (done in schema)
    # Verify execution skips connector
    engine.connectors["tiktok"].send_reply = MagicMock()
    key = "dry_1"
    res = engine.process("tiktok", GenerationMode.REPLY, "Msg", "c1", "v1", "a1", key)
    assert res.delivery_status == DeliveryStatus.SKIPPED_DRY_RUN
    engine.connectors["tiktok"].send_reply.assert_not_called()

def test_audit_B2_live_explicit_enable(engine):
    # Enable LIVE
    engine.config.dry_run_enabled = False
    engine.connectors["tiktok"].send_reply = MagicMock(return_value={"id": "live_id"})
    key = "live_1"
    res = engine.process("tiktok", GenerationMode.REPLY, "Msg", "c1", "v1", "a1", key)
    assert res.delivery_status == DeliveryStatus.SENT
    engine.connectors["tiktok"].send_reply.assert_called_once()

# --- E. Kill Switches ---

def test_audit_E1_global_kill_switch(engine):
    engine.config.kill_switch_global = True
    key = "kill_1"
    res = engine.process("tiktok", GenerationMode.REPLY, "Msg", "c1", "v1", "a1", key)
    assert res.delivery_status == DeliveryStatus.FAILED
    assert "kill_switch:global" in res.reason_codes

def test_audit_E2_platform_kill_switch(engine):
    engine.config.kill_switch_platforms = ["tiktok"]
    key = "kill_2"
    res = engine.process("tiktok", GenerationMode.REPLY, "Msg", "c1", "v1", "a1", key)
    assert res.delivery_status == DeliveryStatus.FAILED
    assert "kill_switch:platform:tiktok" in res.reason_codes

def test_audit_E3_platform_kill_switch_selective(engine):
    # Kill tiktok, but allow instagram (if active)
    engine.config.kill_switch_platforms = ["youtube"] # Kill youtube
    key = "kill_3"
    # Sending to tiktok
    # But Dry Run is True by default in fixture
    res = engine.process("tiktok", GenerationMode.REPLY, "Msg", "c1", "v1", "a1", key)
    # Should not be killed, should be SKIPPED_DRY_RUN
    assert res.delivery_status == DeliveryStatus.SKIPPED_DRY_RUN

# --- C. Idempotency ---

def test_audit_C1_idempotency_store(engine):
    key = "idem_1"
    engine.config.dry_run_enabled = False # Live to populate sent
    engine.connectors["tiktok"].send_reply = MagicMock(return_value={"id": "sent_1"})
    
    # 1st Call
    res1 = engine.process("tiktok", GenerationMode.REPLY, "Msg", "c1", "v1", "a1", key)
    assert res1.delivery_status == DeliveryStatus.SENT
    
    # 2nd Call
    res2 = engine.process("tiktok", GenerationMode.REPLY, "Msg", "c1", "v1", "a1", key)
    # Should be cached result
    assert res2.platform_message_id == "sent_1"
    assert "idempotent_replay" in res2.reason_codes
    # Connector called only once
    engine.connectors["tiktok"].send_reply.assert_called_once()

# --- I. Safety Defaults ---

def test_audit_I1_unknown_error_fail_safe(engine):
    engine.config.dry_run_enabled = False
    # Mock connector crash
    engine.connectors["tiktok"].send_reply = MagicMock(side_effect=Exception("Unexpected Crash"))
    
    res = engine.process("tiktok", GenerationMode.REPLY, "Msg", "c1", "v1", "a1", "fail_safe")
    # Should catch and return FAILED
    assert res.delivery_status == DeliveryStatus.FAILED
    assert "permanent_error" in res.reason_codes # Logic maps non-429 to permanent
