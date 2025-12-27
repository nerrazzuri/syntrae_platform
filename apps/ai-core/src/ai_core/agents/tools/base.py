from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional, Protocol


@dataclass
class ToolSpec:
    tool_id: str
    name: str
    version: str
    description: str
    category: str  # read|write|messaging|scheduling|file|admin
    input_schema: Dict[str, Any]
    output_schema: Dict[str, Any]
    required_scope: str
    sensitive: bool = False
    requires_preapproval: bool = False
    timeout_ms: int = 15000
    retries: int = 2
    rate_limit_qps: int = 2
    idempotency_required: bool = False


class Tool(Protocol):
    spec: ToolSpec

    def execute(
        self, *, tenant_id: str, api_key_id: Optional[str], payload: Dict[str, Any]
    ) -> Dict[str, Any]:
        ...
