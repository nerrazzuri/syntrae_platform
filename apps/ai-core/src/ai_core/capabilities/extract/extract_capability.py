from ai_core.capabilities.base import Capability
from ai_core.contracts.capability_request import CapabilityRequest
from ai_core.contracts.capability_response import CapabilityResponse


class ExtractCapability(Capability):
    async def execute(self, request: CapabilityRequest) -> CapabilityResponse:
        # Adapter placeholder: honor provided structured schema if present
        payload = request.input.get("schema") or {}
        return CapabilityResponse(
            kind="extract",
            payload=payload,
            telemetry={"extract": "schema-pass-through"},
        )
