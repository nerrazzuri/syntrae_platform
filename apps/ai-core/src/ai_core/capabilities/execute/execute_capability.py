from ai_core.capabilities.base import Capability
from ai_core.contracts.capability_request import CapabilityRequest
from ai_core.contracts.capability_response import CapabilityResponse
from ai_core.pipeline.agent_executor import AgentExecutor
from ai_core.agents.sample_agent import SampleAgent  # default example agent
from shared.database.session import SessionLocal


class ExecuteCapability(Capability):
    def __init__(self) -> None:
        self._executor = AgentExecutor(SampleAgent)

    async def execute(self, request: CapabilityRequest) -> CapabilityResponse:
        goal = request.input.get("goal") or request.input.get("query") or ""
        claims = {
            "user_id": request.user_id,
            "api_key_id": (request.context or {}).get("api_key_id"),
            "auth_type": (request.context or {}).get("auth_type"),
        }
        db = SessionLocal()
        try:
            res = self._executor.run(
                goal=goal, tenant_id=request.tenant_id, claims=claims, db=db
            )
            return CapabilityResponse(
                kind="execute", payload=res, telemetry={"agent": res.get("agent")}
            )
        finally:
            db.close()
