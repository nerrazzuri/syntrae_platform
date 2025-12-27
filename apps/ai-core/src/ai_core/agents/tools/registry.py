from __future__ import annotations

from typing import Dict, Optional
from .base import Tool


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: Dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        self._tools[tool.spec.tool_id] = tool

    def get(self, tool_id: str) -> Optional[Tool]:
        return self._tools.get(tool_id)

    def list(self) -> Dict[str, Tool]:
        return dict(self._tools)


tool_registry = ToolRegistry()
