from __future__ import annotations

import json
import os
import logging
from typing import Dict, Any, List, Optional
from .base import BaseAgent, Capability
from openai import OpenAI

logger = logging.getLogger(__name__)

class LLMAgent(BaseAgent):
    name = "llm_agent"

    def __init__(self):
        self.model = "gpt-3.5-turbo" # Default, can be env var
        self.max_steps = 5
        
    def capabilities(self) -> List[Capability]:
        # Inherit capabilities from SampleAgent for now, or define new ones.
        # For this phase, we'll replicate SampleAgent's capabilities but use LLM to decide.
        return [
            Capability(
                name="summarize_context",
                description="Use RAG pipeline to summarize content about a topic",
                required_permission="agent:action:summarize_context",
                input_schema={
                    "type": "object",
                    "properties": {"query": {"type": "string"}},
                },
                output_schema={"type": "object"},
            ),
            Capability(
                name="create_ticket",
                description="Create a support ticket",
                required_permission="agent:action:create_ticket",
                input_schema={
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "body": {"type": "string"},
                    },
                },
                output_schema={"type": "object"},
            ),
        ]

    def tools(self):
        # Re-use the logic from SampleAgent for actual execution
        # In a real refactor, these should be moved to a shared 'tools' module
        def summarize(tenant_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
            from ai_core.pipeline.rag_pipeline import RAGPipeline
            q = str(params.get("query", ""))
            pipe = RAGPipeline()
            out = pipe.answer(q, tenant_id=tenant_id)
            return {
                "response": out.get("response", ""),
                "citations": out.get("citations", []),
                # Pass reasoning steps if available, or we'll generate them in the agent
            }

        def create_ticket(tenant_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
            return {"id": "TKT-1001", "title": params.get("title"), "status": "OPEN"}

        return {
            "summarize_context": summarize,
            "create_ticket": create_ticket,
        }

    def plan(self, goal: str, context: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Execute ReAct loop to determine actions.
        Returns a list of actions to be executed by the caller (or executes them internally and returns final result).
        """
        client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
        tenant_id = context.get("tenant_id", "default")
        available_tools = self.tools()
        
        # System prompt for ReAct
        system_prompt = f"""
You are a smart AI assistant. You have access to the following tools:

{json.dumps([{"name": c.name, "description": c.description, "input": c.input_schema} for c in self.capabilities()], indent=2)}

To answer the user request, you verify if you need to use a tool.
If you need a tool, you respond with:
Thought: <your reasoning>
Action: <tool_name>
Action Input: <json_params>

If you have the answer or don't need a tool, respond with:
Thought: I have the answer.
Final Answer: <your answer>

Begin!
"""
        
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": goal}
        ]
        
        steps = []
        
        for i in range(self.max_steps):
            try:
                response = client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    temperature=0,
                    stop=["Observation:"]
                )
                
                content = response.choices[0].message.content
                messages.append({"role": "assistant", "content": content})
                
                # Parse response
                lines = content.split('\n')
                
                # Check for Final Answer first
                if "Final Answer:" in content:
                     final_ans = content.split("Final Answer:")[-1].strip()
                     reflected_ans = self.reflect(goal, final_ans)
                     return [{"action": "final_answer", "params": {"response": reflected_ans, "steps": steps}}]

                action_line = next((l for l in lines if l.startswith("Action:")), None)
                
                if action_line:
                    action_name = action_line.replace("Action:", "").strip()
                    
                    if action_name == "final_answer":
                        final_ans = content
                        reflected_ans = self.reflect(goal, final_ans)
                        return [{"action": "final_answer", "params": {"response": reflected_ans, "steps": steps}}]

                    # Parse Input
                    input_line = next((l for l in lines if l.startswith("Action Input:")), "{}")
                    input_str = input_line.replace("Action Input:", "").strip()
                    
                    try:
                        params = json.loads(input_str)
                    except:
                        # Fallback for simple string input if LLM messes up JSON
                        params = {"query": input_str} 

                    # Execute Tool
                    if action_name in available_tools:
                        logger.info(f"Executing tool {action_name} with params {params}")
                        tool_func = available_tools[action_name]
                        observation = tool_func(tenant_id, params)
                        
                        # Add observation to history
                        obs_str = f"Observation: {json.dumps(observation)}"
                        messages.append({"role": "user", "content": obs_str})
                        
                        # Store step for debugging/frontend
                        steps.append({
                            "action": action_name,
                            "input": str(params),
                            "thought": next((l for l in lines if l.startswith("Thought:")), "").replace("Thought:", "").strip(),
                            "output": str(observation)
                        })
                    else:
                         messages.append({"role": "user", "content": f"Observation: Tool {action_name} not found."})
                else:
                    # Assume final answer if no action and no explicit Final Answer tag
                    reflected_ans = self.reflect(goal, content)
                    return [{"action": "final_answer", "params": {"response": reflected_ans, "steps": steps}}]
            
            except Exception as e:
                logger.error(f"LLM Agent Error: {e}")
                return [{"action": "error", "params": {"error": str(e)}}]

        return [{"action": "final_answer", "params": {"response": "I could not complete the request within the step limit."}}]

    def reflect(self, goal: str, answer: str) -> str:
        """
        Self-correction step: Critique the answer and improve it if necessary.
        """
        client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
        
        prompt = f"""
You are a critical reviewer.
User Goal: {goal}
Proposed Answer: {answer}

Critique the answer. Is it accurate? Does it directly answer the goal?
If it's good, output the answer as is.
If it needs improvement, output a better version.
Only output the final improved answer, nothing else.
"""
        try:
            response = client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            logger.warning(f"Reflection failed: {e}")
            print(f"DEBUG: Reflection failed: {e}")
            return answer
