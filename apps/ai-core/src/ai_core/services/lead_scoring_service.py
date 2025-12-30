import logging
import uuid
from typing import List, Optional, Dict, Any
from datetime import datetime

from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from shared.database.models import LeadOpportunity, BuyerStage, RecommendedAction
from shared.database.session import SessionLocal
from ai_core.services.brand_service import BrandService, BrandNotFoundError, BrandInactiveError

logger = logging.getLogger(__name__)

class LeadScoringService:
    """
    Service to evaluate cognitive signals and classify them into Buyer Stages.
    Persists qualified Lead Opportunities to the database.
    """

    def __init__(self):
        pass

    def evaluate_and_persist(
        self,
        text: str,
        signals: List[Dict[str, Any]],
        context_data: Dict[str, Any],
        ts_intents: Optional[List[str]] = None
    ) -> Optional[LeadOpportunity]:
        """
        Evaluate text/signals and persist a LeadOpportunity if qualified.

        Args:
            text: Raw comment text.
            signals: List of detected/inferred signals (e.g. {'type': 'VALUE_EVALUATION', 'confidence': 0.9}).
            context_data: Metadata containing platform, comment_id, video_id, user_handle, etc.
        """
        # 1. Validate Context (Required for Persistence)
        platform = context_data.get("platform")
        comment_id = context_data.get("comment_id")
        video_id = context_data.get("video_id")
        source_event_id = context_data.get("source_event_id")
        account_id = context_data.get("account_id")
        brand_id = context_data.get("brand_id")

        if not (platform and comment_id and video_id and source_event_id):
            logger.warning(
                "LeadScoring: Missing context for persistence.",
                extra={"context_keys": list(context_data.keys())}
            )
            return None

        # account_id is also critical for Phase 30 safety
        if not context_data.get("account_id"):
             logger.warning("LeadScoring: Missing account_id. Aborting persistence.")
             return None

        # 2. Brand Safety & Context (Phase 33)
        domain_context = {}
        if brand_id:
            try:
                domain_context = BrandService.get_brand_context(brand_id)
            except (BrandNotFoundError, BrandInactiveError) as e:
                # Abort persistence for invalid/paused brands. Do NOT crash.
                logger.warning(f"LeadScoring: Skipping lead creation. Reason: {e}")
                return None
            except Exception as e:
                # Log but fallback safely? No, strict safety says abort if we can't verify brand status?
                # User says: "If Brand.status != ACTIVE -> abort processing"
                # If DB is down, better to not process than process unsafely.
                logger.error(f"LeadScoring: Brand verification error: {e}")
                return None
        
        # 3. Determine Buyer Stage & Intent
        # Separated signals: TS intents passed explicitly or extracted, AI signals passed in 'signals'
        # To avoid signature change breaking call sites, we extract if mixed or use argument if added
        detected_intents = ts_intents or context_data.get("detected_intents", [])
        
        stage, intent, raw_confidence, debug_meta = self._map_to_stage(signals, detected_intents, text)

        if not stage:
            return None

        # 4. Apply Domain Modifiers (Phase 33)
        # Post-processing confidence adjustment
        final_confidence = self._apply_domain_modifiers(text, raw_confidence, domain_context)
        
        # Log adjustment for traceability
        if final_confidence != raw_confidence:
             debug_meta["domain_adj"] = round(final_confidence - raw_confidence, 2)
             debug_meta["raw_conf"] = raw_confidence

        # 5. Determine Recommended Action
        action = self._determine_action(stage, final_confidence, context_data)

        # 6. Persist
        try:
             with SessionLocal() as db:
                lead = LeadOpportunity(
                    id=str(uuid.uuid4()),
                    platform=platform,
                    video_id=video_id,
                    comment_id=comment_id,
                    user_handle=context_data.get("user_handle"),
                    user_profile_url=context_data.get("user_profile_url"),
                    intent=intent,
                    buyer_stage=stage, # Enum instance auto-handled or use .value if strings preferred
                    confidence=final_confidence,
                    recommended_action=action,
                    urgency_score=self._calculate_urgency(stage, final_confidence),
                    risk_level="LOW",
                    source_event_id=source_event_id,
                    account_id=account_id, # Phase 30: Multi-tenant safety
                    brand_id=brand_id, # Phase 33 linkage
                    preferences={**context_data.get("preferences", {}), **debug_meta},
                    created_at=datetime.utcnow()
                )
                db.add(lead)
                db.commit()
                db.refresh(lead)
                
                logger.info(
                    f"LeadOpportunity persisted: {lead.id}", 
                    extra={
                        "stage": stage.value, 
                        "intent": intent, 
                        "account_id": account_id,
                        "brand_id": brand_id,
                        "platform": platform,
                        "conf": final_confidence
                    }
                )
                return lead
        except IntegrityError:
            logger.info("LeadScoring: Duplicate lead opportunity skipped (deduplication).")
            return None
        except Exception as e:
            logger.error(f"LeadScoring: Persistence failed: {e}")
            return None

    def _map_to_stage(self, ai_signals: List[Dict[str, Any]], ts_intents: List[str], text: str):
        """
        Map signals to BuyerStage.
        Separates AI (cognitive) signals from TS (keyword/regex) intents.
        """
        # Process AI Signals
        ai_types = set()
        ai_conf = 0.0
        for s in ai_signals:
            stype = s.get("type") or s.get("signal")
            conf = s.get("confidence", 0.0)
            if stype:
                ai_types.add(stype.upper())
                ai_conf = max(ai_conf, conf)

        # Process TS Intents (strings)
        ts_types = {t.upper() for t in ts_intents}
        
        # 1. READY (High Intent)
        # Rely on TS 'PRODUCT_INQUIRY' or explicit keywords, OR AI 'URGENCY' if we had it.
        if "PRODUCT_INQUIRY" in ts_types: 
            # User Feedback (Phase 30.5): Don't mask AI confidence. Store both.
            return BuyerStage.READY, "PRODUCT_INQUIRY", 0.9, {"ts_conf": 0.9, "ai_conf": ai_conf}

        text_lower = text.lower()
        if "buy" in text_lower or "price" in text_lower or "cost" in text_lower:
             if "how much" in text_lower:
                 return BuyerStage.READY, "PRICING_INQUIRY", 0.8, {"ts_conf": 0.8, "ai_conf": ai_conf}

        # 2. EVALUATING
        # AI Signals are best here
        eval_signals = {
            "VALUE_EVALUATION", 
            "COST_BENEFIT_HESITATION", 
            "FIT_SUITABILITY", 
            "PROBLEM_SOLUTION",
            "UTILIZATION_DOUBT",
            "CONTEXT_FIT_EVALUATION"
        }
        
        common = ai_types.intersection(eval_signals)
        if common:
            # return first match as intent
            intent = list(common)[0]
            if intent == "COST_BENEFIT_HESITATION": intent = "COST_HESITATION"
            elif intent == "FIT_SUITABILITY": intent = "FIT_CHECK"
            
            return BuyerStage.EVALUATING, intent, ai_conf, {"ts_conf": 0.0, "ai_conf": ai_conf}

        # 3. AWARENESS
        awareness_signals = {"AESTHETIC_PREFERENCE", "PREFERENCE", "AWARENESS"}
        if not ai_types.isdisjoint(awareness_signals):
             return BuyerStage.AWARENESS, "INTEREST", ai_conf, {"ts_conf": 0.0, "ai_conf": ai_conf}

        return None, None, 0.0, {}

    def _determine_action(self, stage: BuyerStage, confidence: float, context: Dict) -> RecommendedAction:
        if stage == BuyerStage.READY:
            return RecommendedAction.PRIORITY_DM
        
        if stage == BuyerStage.EVALUATING:
            if confidence > 0.8:
                return RecommendedAction.RECOMMEND_DM
            return RecommendedAction.SILENT_CAPTURE
            
        return RecommendedAction.SILENT_CAPTURE

    def _calculate_urgency(self, stage: BuyerStage, confidence: float) -> float:
        if stage == BuyerStage.READY:
            return 0.9 * confidence
        if stage == BuyerStage.EVALUATING:
            return 0.6 * confidence
        return 0.3 * confidence

    def _apply_domain_modifiers(self, text: str, confidence: float, domain_context: Dict) -> float:
        """
        Adjust confidence based on domain-specific keywords.
        Strict caps applied to prevent runaway scores.
        """
        if not domain_context:
            return confidence

        text_lower = text.lower()
        adjustment = 0.0
        
        # 1. Keywords Boost
        keywords = domain_context.get("keywords", [])
        if any(k.lower() in text_lower for k in keywords):
            adjustment += 0.1
            
        # 2. Negative Signals Penalty
        negatives = domain_context.get("negative_signals", [])
        if any(n.lower() in text_lower for n in negatives):
            adjustment -= 0.15

        # 3. Explicit Preference Boost
        # e.g. {"shade_preference": 0.15}
        boosts = domain_context.get("confidence_boosts", {})
        for key, boost_val in boosts.items():
             # Basic logic: checks if key is in text (naive but deterministic)
             # In future, this could be more sophisticated signal matching
             if key.lower() in text_lower:
                 adjustment += float(boost_val)

        # CAP: Max adjustment +/- 0.25 (Guardrail A)
        adjustment = max(-0.25, min(0.25, adjustment))
        
        final_conf = confidence + adjustment
        
        # Clamp [0.0, 1.0]
        return max(0.0, min(1.0, final_conf))
