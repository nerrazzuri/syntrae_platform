from typing import Dict
from ai_core.contracts.capability_request import CapabilityRequest
from ai_core.contracts.capability_response import CapabilityResponse


async def structured_query_flow(
    capabilities: Dict[str, object], request: CapabilityRequest
) -> CapabilityResponse:
    extract = capabilities["extract"]
    search = capabilities["search"]
    score = capabilities["score"]
    answer = capabilities["answer"]

    extract_resp = await extract.execute(request)
    req_with_struct = request.model_copy(
        update={"input": {**request.input, "structured": extract_resp.payload}}
    )

    search_resp = await search.execute(req_with_struct)
    req_with_docs = req_with_struct.model_copy(
        update={"input": {**req_with_struct.input, "retrieved": search_resp.payload}}
    )

    score_resp = await score.execute(req_with_docs)
    req_with_scores = req_with_docs.model_copy(
        update={"input": {**req_with_docs.input, "scores": score_resp.payload}}
    )

    answer_resp = await answer.execute(req_with_scores)

    merged_citations = (search_resp.citations or []) + (answer_resp.citations or [])
    merged_telemetry = {
        "extract": extract_resp.telemetry,
        "search": search_resp.telemetry,
        "score": score_resp.telemetry,
        "answer": answer_resp.telemetry,
    }
    return CapabilityResponse(
        payload=answer_resp.payload,
        citations=merged_citations or None,
        confidence=answer_resp.confidence,
        telemetry=merged_telemetry,
        policy_decisions=answer_resp.policy_decisions,
    )
