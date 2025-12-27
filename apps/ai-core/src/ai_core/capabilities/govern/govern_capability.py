from ai_core.capabilities.base import Capability
from ai_core.contracts.capability_request import CapabilityRequest
from ai_core.contracts.capability_response import CapabilityResponse
from ai_core.services.redactor import Redactor

# Optional policy hooks (semantic interpretation); alias to expected name
try:
    from ai_core.services.semantic_interpreter import (
        SemanticContextInterpreter as SemanticInterpreter,  # type: ignore
    )
except Exception:  # pragma: no cover
    SemanticInterpreter = None  # type: ignore


class GovernCapability(Capability):
    def __init__(self) -> None:
        self._redactor = Redactor()
        try:
            self._policy = SemanticInterpreter()
        except Exception:
            self._policy = None

    async def execute(self, request: CapabilityRequest) -> CapabilityResponse:
        text = request.input.get("text") or request.input.get("query") or ""
        redacted = self._redactor.redact_text(text, tenant_id=request.tenant_id)
        decisions = {"redacted": redacted != text}
        return CapabilityResponse(
            kind="govern",
            payload={"text": redacted},
            policy_decisions=decisions,
            telemetry={"govern": "redactor"},
        )
