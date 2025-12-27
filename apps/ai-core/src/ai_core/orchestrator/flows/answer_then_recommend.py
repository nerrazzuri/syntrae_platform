from typing import Dict
from ai_core.contracts.capability_request import CapabilityRequest
from ai_core.contracts.capability_response import CapabilityResponse


async def answer_then_recommend_flow(
    capabilities: Dict[str, object], request: CapabilityRequest
) -> CapabilityResponse:
    # Search -> Answer -> Recommend
    search = capabilities["search"]
    answer = capabilities["answer"]
    recommend = capabilities["recommend"]

    search_resp = await search.execute(request)
    req_with_docs = request.model_copy(
        update={"input": {**request.input, "retrieved": search_resp.payload}}
    )

    answer_resp = await answer.execute(req_with_docs)
    # Pass raw candidates (search results) to recommend; capability will handle lightweight processing
    ctx_with_candidates = {
        **(request.context or {}),
        "candidates": search_resp.payload,
        "flow": "answer_then_recommend",
    }
    next_req = req_with_docs.model_copy(update={"context": ctx_with_candidates})

    reco_resp = await recommend.execute(next_req)

    merged_citations = (search_resp.citations or []) + (answer_resp.citations or [])
    merged_telemetry = {
        "search": search_resp.telemetry,
        "answer": answer_resp.telemetry,
        "recommend": reco_resp.telemetry,
    }
    return CapabilityResponse(
        kind="answer",
        payload={"answer": answer_resp.payload, "recommendations": reco_resp.payload},
        citations=merged_citations or None,
        confidence=answer_resp.confidence,
        telemetry=merged_telemetry,
        policy_decisions=reco_resp.policy_decisions or answer_resp.policy_decisions,
    )
