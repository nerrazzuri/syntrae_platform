from typing import List, Dict, Optional
import re
import logging

from .schemas import (
    GenerationConfig, MessageResult, MessageAudit, GenerationMode, MessageTemplateType
)

from ..policy.schemas import EnforcementDecision, DecisionType
from ..rag.schemas import ResponsePlan, ResponseType
from ..rag_gateway.service import RAGGatewayService
from ..rag_gateway.schemas import ContentRequest

logger = logging.getLogger(__name__)

class MessageGenerationEngine:
    """
    Phase 8: Message Generation.
    Constrained by Phase 7b (Enforcement).
    Audit Compliance:
    - B1: Dependency Check (Takes EnforcementDecision).
    - B2: Knowledge Access (Uses decision.allowed_knowledge_refs).
    - B3: Constraint Enforcement (Hard Fail on Violation).
    """

    def __init__(self, config: GenerationConfig, gateway: RAGGatewayService):
        self.config = config
        self.gateway = gateway

    def process(self,
                mode: GenerationMode,
                decision: EnforcementDecision, 
                plan: ResponsePlan,
                platform_id: str,
                token: str,
                trace_id: str) -> MessageResult:
        
        audit = MessageAudit(policy_version=decision.audit_trace.get("policy_version", "unknown"), 
                             risk_policy_version=decision.audit_trace.get("risk_version", "unknown"))
        flags = []

        # --- Gate 1: Decision Gate (Audit B1) ---
        if decision.decision in [DecisionType.DENY, DecisionType.DEFER]:
            flags.append(f"blocked_by_enforcement:{decision.decision.value}")
            return self._empty_result(audit, flags)

        # --- Gate 2: Mode Gate ---
        if mode == GenerationMode.REPLY and decision.engagement_type != "reply":
             flags.append("mode_mismatch:reply_not_allowed")
             return self._empty_result(audit, flags)
        
        if mode == GenerationMode.DM and decision.engagement_type != "dm":
             flags.append("mode_mismatch:dm_not_allowed")
             return self._empty_result(audit, flags)

        # --- Content Fetching (Phase 0) ---
        fetched_content = {}
        if decision.allowed_knowledge_refs:
             try:
                 # Strict Fetch: Only allowed refs
                 req = ContentRequest(doc_refs=decision.allowed_knowledge_refs, trace_id=trace_id)
                 res = self.gateway.process_content(token, req)
                 
                 # Verify Extraneous/Missing (Gateway checked strict? No, Gateway just returns found. We check mismatch.)
                 returned_ids = {d.doc_id + ":" + d.version for d in res.docs}
                 # Actually doc_id:version format depends on how gateway returns docs. 
                 # Gateway returns DocumentContent(doc_id, version, content).
                 
                 # Construct map
                 for d in res.docs:
                     key = f"{d.doc_id}:{d.version}"
                     fetched_content[key] = d.content
                     
                     # Hard Fail on Extra (Should not happen if Gateway is compliant, but check redundancy)
                     if key not in decision.allowed_knowledge_refs:
                          flags.append(f"violation:extra_ref_fetched:{key}")
                          return self._empty_result(audit, flags)

                 # Hard Fail on Missing
                 for ref in decision.allowed_knowledge_refs:
                      if ref not in fetched_content:
                           flags.append(f"violation:missing_content:{ref}")
                           return self._empty_result(audit, flags)

             except Exception as e:
                 # Hard Fail on Gateway Error
                 flags.append(f"error:gateway_fetch:{str(e)}")
                 return self._empty_result(audit, flags)

        # --- Generation ---
        try:
            msg, used_refs, used_tmpl = self._generate_via_template(plan, decision, mode, fetched_content)
            audit.llm_used = False
            
            # --- Gate 3: Permission Enforcement (Audit B3: Hard Fail) ---
            # 1. URL Check
            if not decision.constraints.can_include_url:
                if "http" in msg or "www." in msg:
                    # HARD FAIL (Audit B3)
                    flags.append("violation:url_present")
                    return self._empty_result(audit, flags)

            # 2. Price Check
            if not decision.constraints.can_include_price:
                 if re.search(r'[\$€£¥]|USD|RM', msg):
                      # HARD FAIL (Audit B3)
                      flags.append("violation:price_present")
                      return self._empty_result(audit, flags)
            
            # 3. Knowledge Ref Validation (Audit B2)
            # Ensure used refs are in allowed_knowledge_refs
            for ref in used_refs:
                if ref not in decision.allowed_knowledge_refs:
                     flags.append(f"violation:unauthorized_ref:{ref}")
                     return self._empty_result(audit, flags)

            msg_lang = plan.selected_language
            
            return MessageResult(
                message_text=msg,
                message_language=msg_lang,
                used_templates=[used_tmpl] if used_tmpl else [],
                used_knowledge_refs=used_refs,
                safety_flags=flags,
                audit=audit
            )

        except Exception as e:
            # Fail Safe
            flags.append(f"error:message_generation:{str(e)}")
            return self._empty_result(audit, flags)

    def _generate_via_template(self, plan: ResponsePlan, decision: EnforcementDecision, mode: GenerationMode, content: Dict[str, str]):
        """
        Track A: Template Construction with Real Content
        """
        refs = []
        tmpl_type = MessageTemplateType.NONE
        text = ""

        if not plan.candidates:
             return "", [], None
             
        top_cand = plan.candidates[0]
        
        # Select Candidate Ref that is allowed
        # (Candidate might have refs, but Policy might have filtered them. We only use what's in enforcement decision)
        valid_refs = [r for r in top_cand.knowledge_refs if r in decision.allowed_knowledge_refs]
        
        # If intent requires knowledge but no valid refs -> Fallback to Generic? 
        # Or Hard Fail if logic dictates.
        # For now, if valid_refs exist, use the first one.
        
        primary_ref = valid_refs[0] if valid_refs else None
        doc_text = content.get(primary_ref, "") if primary_ref else ""

        can_url = decision.constraints.can_include_url
        can_price = decision.constraints.can_include_price
        
        # Determine Template Type & Fill
        if top_cand.response_type == ResponseType.PRODUCT_INFO:
            if not can_price and not can_url:
                 tmpl_type = MessageTemplateType.GENERIC_HELP
                 text = self.config.templates[tmpl_type]
            elif can_url:
                 tmpl_type = MessageTemplateType.PURCHASE_LINK
                 # Extract URL from doc_text? Or inject doc_text?
                 # Template: "Check this out: {url}"
                 # RAG Doc: "Buy here: http://..."
                 # We assume doc_text has the URL if filtered correctly. 
                 # But we must be careful not to double URL if template has "http".
                 # Simple injection for now: use doc_text as the 'url' or 'details'.
                 text = self.config.templates[tmpl_type].format(url=doc_text)
            else:
                 tmpl_type = MessageTemplateType.PURCHASE_INFO
                 text = self.config.templates[tmpl_type].format(price=doc_text, details="") # Simplified

        elif top_cand.response_type == ResponseType.FAQ:
             tmpl_type = MessageTemplateType.INQUIRY_ANSWER
             text = self.config.templates[tmpl_type].format(answer=doc_text)
        
        elif top_cand.response_type == ResponseType.OBJECTION_HANDLING:
             tmpl_type = MessageTemplateType.OBJECTION_HANDLING
             text = self.config.templates[tmpl_type].format(correction=doc_text)
             
        elif top_cand.response_type == ResponseType.COMPARISON:
             tmpl_type = MessageTemplateType.COMPARISON
             text = self.config.templates[tmpl_type].format(my_product=doc_text, feature="") # Simplified

        elif top_cand.response_type == ResponseType.GENERIC_HELP:
             tmpl_type = MessageTemplateType.GENERIC_HELP
             text = self.config.templates[tmpl_type]

        if primary_ref:
            refs = [primary_ref]
            
        return text, refs, tmpl_type

    def _empty_result(self, audit: MessageAudit, flags: List[str]) -> MessageResult:
        return MessageResult(
            message_text="",
            message_language="unknown",
            used_templates=[],
            used_knowledge_refs=[],
            safety_flags=flags,
            audit=audit
        )
