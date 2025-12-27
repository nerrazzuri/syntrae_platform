from __future__ import annotations

from typing import Dict, Type, Any
import os
import glob
import json
try:
    import yaml  # type: ignore
except Exception:
    yaml = None

from .base import BaseConnector


class ConnectorRegistry:
    def __init__(self) -> None:
        self._reg: Dict[str, Type[BaseConnector]] = {}
        self._specs: Dict[str, Dict[str, Any]] = {}

    def register(self, name: str, cls: Type[BaseConnector]) -> None:
        self._reg[name.strip().lower()] = cls

    def get(self, name: str) -> Type[BaseConnector] | None:
        return self._reg.get(name.strip().lower())

    def names(self):
        return list(self._reg.keys())

    def load_specs(self, specs_dir: str) -> None:
        specs: Dict[str, Dict[str, Any]] = {}
        if not os.path.isdir(specs_dir):
            self._specs = specs
            return
        for path in glob.glob(os.path.join(specs_dir, "*.yaml")) + glob.glob(os.path.join(specs_dir, "*.yml")) + glob.glob(os.path.join(specs_dir, "*.json")):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    if path.endswith(('.yaml', '.yml')) and yaml is not None:
                        data = yaml.safe_load(f)
                    else:
                        data = json.load(f)
                if isinstance(data, dict) and data.get("id"):
                    specs[str(data["id"]).strip().lower()] = data
            except Exception:
                continue
        self._specs = specs

    def spec(self, connector_id: str) -> Dict[str, Any] | None:
        return self._specs.get(connector_id.strip().lower())


registry = ConnectorRegistry()
