from typing import List
from ai_core.capabilities.base import Capability
from ai_core.contracts.capability_request import CapabilityRequest
from ai_core.contracts.capability_response import CapabilityResponse
from ai_core.pipeline.reranker.crossencoder_reranker import CrossEncoderReranker


class ScoreCapability(Capability):
    def __init__(self) -> None:
        self._reranker = CrossEncoderReranker()

    async def execute(self, request: CapabilityRequest) -> CapabilityResponse:
        docs: List[str] = list(request.input.get("retrieved") or [])
        reranked = self._reranker.rerank(request.input.get("query", ""), docs)
        return CapabilityResponse(
            kind="score",
            payload=reranked,
            telemetry={"reranker": "cross-encoder"},
        )
