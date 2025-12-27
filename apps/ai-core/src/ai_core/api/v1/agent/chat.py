from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Dict, Any, Optional, List
from ai_core.agents.llm_agent import LLMAgent

router = APIRouter(prefix="/v1/agent", tags=["agent"])

class AgentQueryRequest(BaseModel):
    tenant_id: str
    query: str
    context: Optional[Dict[str, Any]] = {}

class AgentQueryResponse(BaseModel):
    response: str
    steps: Optional[List[Dict[str, Any]]] = []

@router.post("/chat", response_model=AgentQueryResponse)
async def agent_chat(payload: AgentQueryRequest):
    agent = LLMAgent()
    
    # Context setup
    context = payload.context or {}
    context["tenant_id"] = payload.tenant_id
    
    # Run agent
    # plan() returns a list of actions. For LLMAgent, the last action is "final_answer".
    # We also want to capture the steps (thoughts/actions) for the UI.
    # The current LLMAgent.plan() implementation executes tools internally and returns the final answer action.
    # To expose steps, we might need to modify LLMAgent to return them, or rely on the fact that plan() returns a list.
    # Wait, my LLMAgent.plan() returns `[{"action": "final_answer", ...}]` or error.
    # It DOES NOT return the intermediate steps in the return value, but it collects them in `steps` variable.
    # I should modify LLMAgent to return the steps too.
    
    # For now, let's assume I modify LLMAgent to return the full history or I just return the final answer.
    # Let's modify LLMAgent to return the steps in the final action params or as a separate return.
    # Actually, BaseAgent.plan signature is fixed: -> List[Dict].
    # I can put the steps in the "params" of the final answer.
    
    actions = agent.plan(payload.query, context)
    final_action = actions[-1]
    
    if final_action["action"] == "final_answer":
        response = final_action["params"].get("response", "")
        steps = final_action["params"].get("steps", []) # I need to add this to LLMAgent
        return AgentQueryResponse(response=response, steps=steps)
    
    return AgentQueryResponse(response="Agent could not produce a final answer.", steps=[])
