from enum import Enum
from typing import List, Optional, Dict
from pydantic import BaseModel, Field
import datetime

class DeliveryStatus(str, Enum):
    SENT = "sent"
    FAILED = "failed"
    DEFERRED = "deferred"
    SKIPPED_DRY_RUN = "skipped_dry_run" # New for Audit B

class ConnectorType(str, Enum):
    MOCK = "mock"
    TIKTOK = "tiktok"
    INSTAGRAM = "instagram"

class DeliveryAudit(BaseModel):
    delivered_at: Optional[datetime.datetime] = None
    platform: str
    connector_version: str = "1.0"
    attempt_count: int = 0

class DeliveryResult(BaseModel):
    """
    Final output of Phase 9.
    """
    delivery_status: DeliveryStatus
    platform_message_id: Optional[str] = None
    attempt_count: int = 0
    next_retry_at: Optional[datetime.datetime] = None
    reason_codes: List[str] = Field(default_factory=list)
    audit: DeliveryAudit

class DeliveryConfig(BaseModel):
    """
    Configuration for Delivery Engine.
    Audit B: Dry Run Default True.
    Audit E: Kill Switches.
    """
    tenant_id: str
    retry_max_attempts: int = 3
    retry_base_delay_seconds: int = 2
    
    # Safety Controls
    dry_run_enabled: bool = True # Audit B1/B2
    kill_switch_global: bool = False # Audit E1
    kill_switch_platforms: List[str] = Field(default_factory=list) # Audit E2
    
    # Connector settings
    active_connectors: Dict[str, ConnectorType] = {"tiktok": ConnectorType.MOCK}
