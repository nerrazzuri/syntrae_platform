from abc import ABC, abstractmethod
from ai_core.contracts.capability_request import CapabilityRequest
from ai_core.contracts.capability_response import CapabilityResponse


class Capability(ABC):
    @abstractmethod
    async def execute(self, request: CapabilityRequest) -> CapabilityResponse:
        ...
