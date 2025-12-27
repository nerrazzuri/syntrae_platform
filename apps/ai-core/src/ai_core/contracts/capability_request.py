from pydantic import BaseModel
from typing import Any, Dict, List, Optional


class CapabilityRequest(BaseModel):
    tenant_id: str
    user_id: str
    roles: List[str]
    channel: str
    input: Dict[str, Any]
    context: Dict[str, Any]
    constraints: Dict[str, Any]
    trace_id: Optional[str] = None
