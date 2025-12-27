from typing import Dict
from ai_core.contracts.capability_request import CapabilityRequest
from ai_core.contracts.capability_response import CapabilityResponse


async def default_answer_flow(
    capabilities: Dict[str, object], request: CapabilityRequest
) -> CapabilityResponse:
    search = capabilities["search"]
    answer = capabilities["answer"]

    search_resp = await search.execute(request)
    # Attach retrieved docs as input to answer
    next_req = request.model_copy(
        update={"input": {**request.input, "retrieved": search_resp.payload}}
    )
    answer_resp = await answer.execute(next_req)

    # Merge telemetry/citations
    merged_citations = (search_resp.citations or []) + (answer_resp.citations or [])
    merged_telemetry = {
        "search": search_resp.telemetry,
        "answer": answer_resp.telemetry,
    }
    return CapabilityResponse(
        payload=answer_resp.payload,
        citations=merged_citations or None,
        confidence=answer_resp.confidence,
        telemetry=merged_telemetry,
        policy_decisions=answer_resp.policy_decisions,
    )
