from ai_core.capabilities.base import Capability
from ai_core.contracts.capability_request import CapabilityRequest
from ai_core.contracts.capability_response import CapabilityResponse
from ai_core.pipeline.rag_pipeline import RAGPipeline
from shared.database.session import SessionLocal


class AnswerCapability(Capability):
    def __init__(self) -> None:
        self._pipeline = RAGPipeline()

    async def execute(self, request: CapabilityRequest) -> CapabilityResponse:
        db = SessionLocal()
        try:
            query = request.input.get("query", "")
            res = self._pipeline.answer(
                query=query,
                tenant_id=request.tenant_id,
                preselected_contexts=request.input.get("retrieved"),
                db=db,
                user_id=request.user_id,
                role=",".join(request.roles) if request.roles else None,
                channel=request.channel,
                correlation_id=request.trace_id,
            )
            return CapabilityResponse(
                kind="answer",
                payload=res,
                citations=res.get("citations"),
                confidence={"qc": float(res.get("confidence", 0.0))}
                if isinstance(res, dict)
                else None,
                telemetry={"pipeline": "rag_pipeline"},
                policy_decisions=None,
            )
        finally:
            db.close()
