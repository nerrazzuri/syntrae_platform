from __future__ import annotations

from typing import Dict, Type
from .base import BaseAgent


class AgentRegistry:
    def __init__(self) -> None:
        self._reg: Dict[str, Type[BaseAgent]] = {}

    def register(self, name: str, cls: Type[BaseAgent]) -> None:
        self._reg[name.strip().lower()] = cls

    def get(self, name: str) -> Type[BaseAgent] | None:
        return self._reg.get(name.strip().lower())

    def names(self):
        return list(self._reg.keys())


registry = AgentRegistry()
