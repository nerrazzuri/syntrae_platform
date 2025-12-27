from typing import Callable, Dict
from ai_core.contracts.capability_request import CapabilityRequest
from ai_core.contracts.capability_response import CapabilityResponse
from ai_core.orchestrator.flows.default_answer import default_answer_flow
from ai_core.orchestrator.flows.structured_query import structured_query_flow
from ai_core.orchestrator.flows.recommend_only import recommend_only_flow
from ai_core.orchestrator.flows.answer_then_recommend import answer_then_recommend_flow


FlowFn = Callable[[Dict[str, object], CapabilityRequest], "CapabilityResponse"]


def select_flow(request: CapabilityRequest):
    # Allow explicit flow override via context
    flow_key = (request.context or {}).get("flow")
    if flow_key == "structured_query":
        return structured_query_flow
    if flow_key == "recommend_only":
        return recommend_only_flow
    if flow_key == "answer_then_recommend":
        return answer_then_recommend_flow
    # Heuristic fallback only
    if "schema" in (request.input or {}):
        return structured_query_flow
    return default_answer_flow
