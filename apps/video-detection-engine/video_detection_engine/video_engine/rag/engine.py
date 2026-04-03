from typing import List, Dict, Any, Optional
import datetime

from .schemas import ResponsePlan, ResponseCandidate, ResponseType
from ..intent.schemas import IntentResult, IntentType, CommentData
from ..core.schemas import DetectionResult
from ..rag_gateway.service import RAGGatewayService
from ..rag_gateway.schemas import RetrieveRequest, RetrieveResponse

class RAGResponseEngine:
    """
    Phase 5: Knowledge Selection.
    Selects response content (RAG) based on Intent and Video Context.
    
    Architecture:
    - Calls Phase 0 RAG Gateway (Strict Single Access Path)
    - Metadata Only (No content inspection)
    - Fail-Closed
    """
    
    # Validation Map (Intent -> Allowed Types)
    ALLOWED_TYPES = {
        IntentType.PURCHASE: [ResponseType.PRODUCT_INFO, ResponseType.FAQ],
        IntentType.INQUIRY: [ResponseType.FAQ, ResponseType.PRODUCT_INFO],
        IntentType.OBJECTION: [ResponseType.OBJECTION_HANDLING, ResponseType.FAQ],
        IntentType.COMPARISON: [ResponseType.COMPARISON, ResponseType.PRODUCT_INFO],
        IntentType.PRAISE: [ResponseType.GENERIC_HELP],
        IntentType.NEGATIVE: [ResponseType.GENERIC_HELP],
        IntentType.SPAM: [],
        IntentType.UNKNOWN: []
    }

    def __init__(self, gateway: RAGGatewayService):
        self.gateway = gateway

    def process(self, 
                comment: CommentData, 
                detection: DetectionResult, 
                intent: IntentResult,
                token: str,
                language: str = "auto",
                trace_id: str = "unknown_trace") -> ResponsePlan:
        try:
            return self._unsafe_process(comment, detection, intent, token, language, trace_id)
        except Exception as e:
            # Safe Failure: If RAG fails, we must abort (Fail-Closed) if intent requires knowledge?
            # Prompt says: "Phase 5 must hard-fail if ... RAG Gateway is unavailable ...".
            # So we re-raise exception to let Orchestrator handle the fail-closed.
            # Orchestrator catches exception and marks FAILED.
            print(f"RAG Engine Error: {e}") 
            raise e

    def _unsafe_process(self, 
                       comment: CommentData, 
                       detection: DetectionResult, 
                       intent: IntentResult,
                       token: str,
                       language: str,
                       trace_id: str) -> ResponsePlan:
        
        # --- Gate 1: Actionability ---
        if not intent.is_actionable:
            return ResponsePlan(candidates=[], selected_language=language)

        # --- Step 1: Determine Strategy ---
        allowed = self.ALLOWED_TYPES.get(intent.intent_type, [])
        if not allowed:
             return ResponsePlan(candidates=[], selected_language=language)

        # --- Step 2: Call RAG Gateway ---
        # Construct Query
        # Use query text + semantic signals (e.g. niche) in headers/filter if supported
        # For now, strict contract says Payload works.
        
        req = RetrieveRequest(
            query=comment.text,
            trace_id=trace_id, # Use propagated trace_id
            top_k=5,
            filters={"niche": detection.niche} # Optimization
        )
        
        # Call Gateway (Strict dependency)
        rag_res = self.gateway.process_retrieve(token, req)
        
        # --- Step 3: Selection Logic (Metadata Only) ---
        candidates = []
        
        for doc in rag_res.results:
            # Check if doc_type is allowed for this intent
            # doc.metadata.doc_type -> mapped to ResponseType?
            # Need a mapping or check metadata relevance.
            
            # Heuristic Mapping
            r_type = self._map_doc_type(doc.metadata.doc_type)
            
            if r_type not in allowed:
                continue
                
            # Filter by Risk
            if doc.metadata.compliance_level == "risky":
                continue 
                
            cand = ResponseCandidate(
                response_type=r_type,
                confidence=doc.score,
                knowledge_refs=[f"{doc.doc_id}:{doc.version}"],
                reason_tags=[
                    f"intent={intent.intent_type.value}",
                    f"doc_type={doc.metadata.doc_type}",
                    f"score={doc.score}"
                ]
            )
            candidates.append(cand)

        # --- Validation ---
        if not candidates and intent.intent_type in [IntentType.PURCHASE, IntentType.INQUIRY]:
             # "Phase 5 must hard-fail if ... no candidates can be selected and intent requires knowledge"
             raise ValueError(f"No valid knowledge found for intent {intent.intent_type}")

        return ResponsePlan(
            candidates=candidates,
            selected_language=language
        )

    def _map_doc_type(self, doc_type: str) -> ResponseType:
        # Map metadata type to ResponseType
        mapping = {
            "faq": ResponseType.FAQ,
            "product_info": ResponseType.PRODUCT_INFO,
            "objection": ResponseType.OBJECTION_HANDLING,
            "comparison": ResponseType.COMPARISON,
            "general": ResponseType.GENERIC_HELP
        }
        return mapping.get(doc_type, ResponseType.GENERIC_HELP)
