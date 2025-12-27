from __future__ import annotations

from typing import Dict, Any, List
from .base import BaseAgent, Capability


class SampleAgent(BaseAgent):
    name = "sample_agent"

    def capabilities(self) -> List[Capability]:
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
                description="Create a support ticket (demo stub)",
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
        def summarize(tenant_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
            from ai_core.pipeline.rag_pipeline import RAGPipeline

            q = str(params.get("query", ""))
            pipe = RAGPipeline()
            out = pipe.answer(q, tenant_id=tenant_id)
            return {
                "response": out.get("response", ""),
                "citations": out.get("citations", []),
            }

        def create_ticket(tenant_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
            # Stub: in real case this would call a connector action under policy control
            return {"id": "TKT-1001", "title": params.get("title"), "status": "OPEN"}

        return {
            "summarize_context": summarize,
            "create_ticket": create_ticket,
        }

    def plan(self, goal: str, context: Dict[str, Any]) -> List[Dict[str, Any]]:
        # Very simple demo plan: if looks like summarization, call summarize_context; else create_ticket
        g = (goal or "").lower()
        if any(w in g for w in ["summarize", "explain", "overview", "what is"]):
            return [{"action": "summarize_context", "params": {"query": goal}}]
        if any(w in g for w in ["ticket", "issue", "bug"]):
            return [
                {
                    "action": "create_ticket",
                    "params": {"title": goal, "body": "Auto-created by agent."},
                }
            ]
        # Fallback to summarization
        return [{"action": "summarize_context", "params": {"query": goal}}]
