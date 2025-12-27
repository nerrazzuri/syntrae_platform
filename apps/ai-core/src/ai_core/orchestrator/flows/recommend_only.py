from typing import Dict
from ai_core.contracts.capability_request import CapabilityRequest
from ai_core.contracts.capability_response import CapabilityResponse


async def recommend_only_flow(
    capabilities: Dict[str, object], request: CapabilityRequest
) -> CapabilityResponse:
    # Search -> Score -> Recommend
    search = capabilities["search"]
    score = capabilities["score"]
    recommend = capabilities["recommend"]

    search_resp = await search.execute(request)
    req_with_docs = request.model_copy(
        update={"input": {**request.input, "retrieved": search_resp.payload}}
    )

    score_resp = await score.execute(req_with_docs)
    ctx_with_candidates = {
        **(request.context or {}),
        "candidates": score_resp.payload,
        "flow": "recommend_only",
    }
    next_req = req_with_docs.model_copy(update={"context": ctx_with_candidates})

    reco_resp = await recommend.execute(next_req)

    merged_telemetry = {
        "search": search_resp.telemetry,
        "score": score_resp.telemetry,
        "recommend": reco_resp.telemetry,
    }
    return CapabilityResponse(
        kind="recommend",
        payload=reco_resp.payload,
        citations=search_resp.citations or None,
        confidence=None,
        telemetry=merged_telemetry,
        policy_decisions=reco_resp.policy_decisions,
    )
