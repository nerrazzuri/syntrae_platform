from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Any, List, Protocol


@dataclass
class Capability:
    name: str
    description: str
    required_permission: str  # e.g., "agent:action:create_ticket"
    input_schema: Dict[str, Any]
    output_schema: Dict[str, Any]


class Action(Protocol):
    def __call__(self, tenant_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
        ...


class BaseAgent:
    name: str = "base_agent"

    def capabilities(self) -> List[Capability]:
        return []

    def plan(self, goal: str, context: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Return a list of steps: {"action":"name","params":{...}}"""
        return []

    def tools(self) -> Dict[str, Action]:
        return {}
