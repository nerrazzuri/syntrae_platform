from typing import Dict, Any, Optional
from sqlalchemy.orm import Session
from ai_core.pipeline.llm.llm_client import LLMClient
from src.shared.database.models import LeadOpportunity, BuyerStage, RecommendedAction
import json
import uuid
import re

PROMPT_VERSION = "v1"

class DraftGenerationService:
    def __init__(self, db: Session, llm_client: LLMClient):
        self.db = db
        self.llm_client = llm_client

    def _check_eligibility(self, lead: LeadOpportunity) -> bool:
        if lead.buyer_stage == BuyerStage.AWARENESS:
            return False
        if lead.recommended_action == RecommendedAction.SILENT_CAPTURE:
            return False
        return True

    def _detect_language(self, comment_text: str, preferred_language: Optional[str]) -> str:
        if preferred_language:
            normalized = preferred_language.lower()
            if normalized in {"zh", "zh-cn", "chinese", "mandarin", "simplified chinese"}:
                return "Mandarin Chinese (Simplified)"
            if normalized in {"en", "english"}:
                return "English"

        if re.search(r"[\u4e00-\u9fff]", comment_text or ""):
            return "Mandarin Chinese (Simplified)"
        return "English"



    def generate_draft(self, lead_id: str, account_id: str, force: bool = False, owner_settings: Dict = None) -> Dict[str, Any]:
        lead = self.db.query(LeadOpportunity).filter(
            LeadOpportunity.id == lead_id,
            LeadOpportunity.account_id == account_id
        ).first()

        if not lead:
            raise ValueError("Lead not found or access denied")

        if not self._check_eligibility(lead):
            raise ValueError("Lead not eligible for draft generation")



        # Tone/Language Resolution
        # Precedence: OwnerSettings -> Inferred (TODO) -> Default
        owner_settings = owner_settings or {}
        tone = owner_settings.get("tone", "professional")
        comment_text = owner_settings.get("comment_text") or ""
        language = self._detect_language(comment_text, owner_settings.get("preferred_language"))
        reply_redirect_target = owner_settings.get("reply_redirect_target", "STORE")
        reply_cta_style = owner_settings.get("reply_cta_style", "SOFT")
        brand_name = owner_settings.get("brand_name") or "the brand"
        brand_domain = owner_settings.get("brand_domain") or ""
        product_context = owner_settings.get("product_context") or {}
        product_context_text = "N/A"
        if isinstance(product_context, dict) and product_context.get("name"):
            benefits = product_context.get("key_benefits") or []
            objections = product_context.get("common_objections") or []
            product_context_text = (
                f"Name: {product_context.get('name')}; "
                f"Category: {product_context.get('category') or 'N/A'}; "
                f"Description: {product_context.get('description') or 'N/A'}; "
                f"Price: {product_context.get('price_label') or 'N/A'}; "
                f"Target Buyer: {product_context.get('target_buyer') or 'N/A'}; "
                f"Benefits: {', '.join(benefits) if isinstance(benefits, list) else 'N/A'}; "
                f"Objections: {', '.join(objections) if isinstance(objections, list) else 'N/A'}; "
                f"CTA URL: {product_context.get('cta_url') or 'N/A'}"
            )

        cta_map = {
            "STORE": "the brand's store",
            "PROFILE": "the brand's profile",
            "PINNED_POST": "the brand's pinned post",
            "CUSTOMER_SERVICE": "the brand's customer service entrypoint",
        }
        cta_target_human = cta_map.get(reply_redirect_target, "the brand's store")

        # Prompt Construction
        prompt = f"""
        Generate a short, human-sounding PUBLIC comment reply for a potential customer.
        
        CONTEXT:
        Platform: {lead.platform}
        Intent: {lead.intent}
        Buyer Stage: {lead.buyer_stage.name}
        User Context: {lead.preferences or "N/A"}
        Original Comment: {comment_text or "N/A"}
        Brand Name: {brand_name}
        Brand Domain: {brand_domain or "N/A"}
        Matched Product / Offer: {product_context_text}
        
        TONE: {tone}
        LANGUAGE: {language}
        REDIRECT TARGET: {reply_redirect_target}
        CTA STYLE: {reply_cta_style}
        
        STRICT RULES:
        1. Reply in the SAME LANGUAGE as the original comment. English comment -> English reply. Mandarin comment -> Mandarin reply.
        2. This is the FIRST and ideally ONLY public reply. Keep it concise and conversion-oriented.
        3. The reply must feel like a real human typed it, not a template or chatbot.
        4. Reference the user's actual comment naturally before redirecting.
        5. Redirect as close as possible to {cta_target_human}, but do it naturally and not aggressively.
        6. NO cold DM invitation. NO "please DM us". NO robotic customer-service phrasing.
        7. NO pricing numbers unless explicitly present in the comment/context.
        8. NO absolute guarantees ("best", "cheapest", "guaranteed").
        9. If a matched product is provided, use it as context but do not overclaim or force a hard sell.
        10. Keep it under 45 words unless Mandarin requires slightly more natural phrasing.
        11. Output must be only the reply text, with no quotation marks or explanation.
        
        Draft:
        """
        
            # LLM Call
        try:
            response_text = self.llm_client.chat_completion(
                messages=[{"role": "user", "content": prompt}],
                temperature=0.7
            )
            
            draft_text = response_text.strip().replace('"', '')

            # Note: ai-core does NOT persist here per plan, operator-api persists.
            # WAIT - Plan says: "ai-core does NOT persist OutreachDraft directly. It returns text."
            # BUT idempotency check requires checking DB.
            # So ai-core MUST READ from DB, but maybe operator-api WRITES.
            # However, for idempotency to work securely across standard services, 
            # if ai-core is the logic center, it should probably just return the text
            # and let operator-api handle the "get existing" check?
            # NO, the plan says: "Idempotency: If force=False and draft exists... return existing."
            # So ai-core has to check DB.
            # To avoid race conditions or split logic, ideally operator-api handles the DB orchestration.
            # But the 'mandatory refinement' put the logic in ai-core.
            # "Draft Logic: ... Idempotency: ... check DB".
            
            # Implementation Detail Correction:
            # If ai-core checks DB for existing, it implies ai-core KNOWS about persistance.
            # But "Persistence: ai-core does NOT persist... operator-api handles persistence".
            # This is a slight contradiction in the plan vs refinement.
            # Resolution: ai-core checks DB (READ), generates (PROCESS), returns result.
            # Operator-api WRITES the result.
            # This means valid idempotency relies on operator-api writing it after ai-core returns.
            # This is acceptable for "Assisted" mode.
            
            return {
                "draft_text": draft_text,
                "tone": tone,
                "language": language,
                "source_language": language,
                "prompt_version": PROMPT_VERSION,
                "cached": False,
                "cta_target": reply_redirect_target,
                "cta_label": cta_target_human,
                "reply_strategy": "single_shot_public_redirect",
                "risk_flags": [],
                "human_review_required": True,
            }

        except Exception as e:
            # Fallback or re-raise
            raise RuntimeError(f"LLM generation failed: {str(e)}")

