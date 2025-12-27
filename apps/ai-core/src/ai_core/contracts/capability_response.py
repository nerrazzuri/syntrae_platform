from pydantic import BaseModel
from typing import Any, Dict, List, Optional, Literal


class CapabilityResponse(BaseModel):
    kind: Literal[
        "answer",
        "search",
        "extract",
        "score",
        "recommend",
        "execute",
        "observe",
        "govern",
        "signal_inference",
        "error",
    ]
    payload: Any
    citations: Optional[List[Dict[str, Any]]] = None
    confidence: Optional[Dict[str, float]] = None
    telemetry: Optional[Dict[str, Any]] = None
    policy_decisions: Optional[Dict[str, Any]] = None
