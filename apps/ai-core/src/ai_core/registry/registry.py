from typing import Dict, List, Optional
from pydantic import BaseModel
from ai_core.registry.capability_spec import CapabilitySpec, PlanName
from ai_core.contracts.capability_request import CapabilityRequest


class ValidationResult(BaseModel):
    allowed: bool
    reason: Optional[str] = None


_PLAN_ORDER: Dict[PlanName, int] = {"free": 0, "pro": 1, "enterprise": 2}


class CapabilityRegistry:
    """In-memory registry for capability metadata and centralized validation."""

    def __init__(self) -> None:
        self._specs: Dict[str, CapabilitySpec] = {}

    def register(self, spec: CapabilitySpec) -> None:
        self._specs[spec.name] = spec

    def get(self, name: str) -> Optional[CapabilitySpec]:
        return self._specs.get(name)

    def list(self) -> List[CapabilitySpec]:
        return list(self._specs.values())

    def validate(
        self, spec: CapabilitySpec, request: CapabilityRequest
    ) -> ValidationResult:
        # 1) Capability exists – implicit by having spec
        # 2) Channel allowed
        channel = (request.channel or "").lower()
        if spec.allowed_channels and channel not in {
            c.lower() for c in spec.allowed_channels
        }:
            return ValidationResult(
                allowed=False, reason=f"channel_not_allowed:{channel}"
            )
        # 3) Plan sufficient
        # Prefer explicit plan in context/constraints; fallback to "free"
        plan = (
            str(
                (request.context or {}).get("plan")
                or (request.constraints or {}).get("plan")
                or "free"
            )
            .strip()
            .lower()
        )
        if _PLAN_ORDER.get(plan, 0) < _PLAN_ORDER.get(spec.min_plan, 0):
            return ValidationResult(
                allowed=False, reason=f"plan_insufficient:{plan}<{spec.min_plan}"
            )
        # 4) All requires present in context or constraints
        ctx_keys = set((request.context or {}).keys())
        cst_keys = set((request.constraints or {}).keys())
        union_keys = ctx_keys | cst_keys
        missing = [r for r in (spec.requires or set()) if r not in union_keys]
        if missing:
            return ValidationResult(
                allowed=False, reason=f"requires_missing:{','.join(missing)}"
            )
        # 5) None of forbids present
        present_forbids = [f for f in (spec.forbids or set()) if f in union_keys]
        if present_forbids:
            return ValidationResult(
                allowed=False, reason=f"forbidden_present:{','.join(present_forbids)}"
            )
        # 6) Side effects require allow_tools True
        if spec.side_effects:
            allow_tools = bool(
                (request.constraints or {}).get("allow_tools")
                or (request.context or {}).get("allow_tools")
            )
            if not allow_tools:
                return ValidationResult(allowed=False, reason="side_effects_disallowed")
        return ValidationResult(allowed=True)
