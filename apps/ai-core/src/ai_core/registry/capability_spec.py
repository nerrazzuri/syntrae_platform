from typing import Literal, Set
from pydantic import BaseModel


PlanName = Literal["free", "pro", "enterprise"]
CapabilityKind = Literal[
    "search",
    "answer",
    "extract",
    "score",
    "recommend",
    "execute",
    "observe",
    "govern",
    "signal_inference",
]


class CapabilitySpec(BaseModel):
    """Metadata-only specification describing a capability."""

    name: str
    kind: CapabilityKind
    inputs: Set[str]
    outputs: Set[str]
    requires: Set[str]
    forbids: Set[str]
    min_plan: PlanName
    allowed_channels: Set[str]
    side_effects: bool
    description: str
