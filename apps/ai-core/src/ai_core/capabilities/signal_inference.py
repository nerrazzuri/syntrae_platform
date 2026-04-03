from __future__ import annotations

import logging
import json
import os
from enum import Enum
from typing import List, Optional, Any, Dict
from pydantic import BaseModel, Field

from ai_core.capabilities.base import Capability
from ai_core.contracts.capability_request import CapabilityRequest
from ai_core.contracts.capability_response import CapabilityResponse

# Configure logger
logger = logging.getLogger(__name__)


class SignalType(str, Enum):
    VALUE_EVALUATION = "VALUE_EVALUATION"
    COST_BENEFIT_HESITATION = "COST_BENEFIT_HESITATION"
    UTILIZATION_DOUBT = "UTILIZATION_DOUBT"
    EXCESS_CAPABILITY = "EXCESS_CAPABILITY"
    CONTEXT_FIT_EVALUATION = "CONTEXT_FIT_EVALUATION"


class IntentHint(str, Enum):
    NOISE = "NOISE"
    UNKNOWN = "UNKNOWN"
    PRODUCT_INQUIRY = "PRODUCT_INQUIRY"
    PROBLEM_SOLUTION = "PROBLEM_SOLUTION"
    FIT_SUITABILITY = "FIT_SUITABILITY"
    LATENT_PURCHASE = "LATENT_PURCHASE"
    POST_PURCHASE_REGRET = "POST_PURCHASE_REGRET"


class IntentCategory(str, Enum):
    HIGH_INTENT = "high intent"
    MID_INTENT = "mid intent"
    LOW_INTENT = "low intent"
    JUNK = "junk"


class InferredSignal(BaseModel):
    type: SignalType
    confidence: float


class SignalInferencePayload(BaseModel):
    inferred_signals: List[InferredSignal]
    intent_hint: Optional[IntentHint] = None
    intent_category: Optional[IntentCategory] = None
    intent_confidence: Optional[float] = None
    model: str
    explanation: str = Field(
        ..., description="Debug-only reasoning. Do NOT use for decision making."
    )


class SignalInferenceCapability(Capability):
    name = "signal_inference"

    def __init__(self):
        self.model = os.getenv(
            "SIGNAL_MODEL", "gpt-4o-mini"
        )  # Default generic model, can be overridden

    @staticmethod
    def _qualifying_intents() -> set[IntentHint]:
        return {
            IntentHint.PRODUCT_INQUIRY,
            IntentHint.PROBLEM_SOLUTION,
            IntentHint.FIT_SUITABILITY,
            IntentHint.LATENT_PURCHASE,
            IntentHint.POST_PURCHASE_REGRET,
        }

    @staticmethod
    def _should_resolve_lead_intent(
        intent_category: Optional[IntentCategory],
        intent_hint: Optional[IntentHint],
    ) -> bool:
        return (
            intent_category in {IntentCategory.HIGH_INTENT, IntentCategory.MID_INTENT}
            and intent_hint not in SignalInferenceCapability._qualifying_intents()
        )

    def _resolve_lead_intent_with_openai(
        self,
        client: Any,
        text: str,
        existing_signals: List[Any],
        intent_category: IntentCategory,
    ) -> tuple[Optional[IntentHint], Optional[float], Optional[str]]:
        system_prompt = """
You are a commerce lead-intent resolver.
The comment was already classified by AI as either high intent or mid intent.
Your job is to force-rank the comment into exactly one existing lead-eligible intent.

ALLOWED INTENT_HINT ENUM:
- PRODUCT_INQUIRY
- PROBLEM_SOLUTION
- FIT_SUITABILITY
- LATENT_PURCHASE
- POST_PURCHASE_REGRET

RULES:
1. Output JSON only.
2. Return exactly:
{
  "intent_hint": "ENUM_VALUE",
  "intent_confidence": 0.0-1.0,
  "explanation": "string"
}
3. Do not return UNKNOWN or NOISE.
4. Pick the closest lead-eligible intent even if the wording is indirect.
"""
        user_prompt = f"""
Intent Category: "{intent_category.value}"
Input Text: "{text}"
Existing Signals: {existing_signals}

Resolve this into exactly one lead-eligible intent.
"""
        response = client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.0,
            response_format={"type": "json_object"},
        )
        raw_content = response.choices[0].message.content
        parsed = json.loads(raw_content)

        intent_hint = None
        intent_confidence = None
        explanation = parsed.get("explanation")
        valid_intents = {i.value for i in self._qualifying_intents()}
        intent_hint_raw = parsed.get("intent_hint")
        if isinstance(intent_hint_raw, str) and intent_hint_raw in valid_intents:
            intent_hint = IntentHint(intent_hint_raw)

        intent_confidence_raw = parsed.get("intent_confidence")
        if isinstance(intent_confidence_raw, (int, float)):
            intent_confidence = max(0.0, min(float(intent_confidence_raw), 1.0))

        return intent_hint, intent_confidence, explanation

    async def execute(self, request: CapabilityRequest) -> CapabilityResponse:
        """
        Infer cognitive signals from text.

        Input contract in request.input:
        - text: str
        - existing_signals: List[str] (optional)
        - language: str (optional)
        - domain: str (optional) - LOGGING ONLY, DO NOT BRANCH LOGIC
        """
        try:
            # 1. Parse Input
            text = request.input.get("text")
            if not text:
                return CapabilityResponse(
                    kind="error", payload={"error": "missing_text"}
                )

            existing_signals = request.input.get("existing_signals", [])
            domain = request.input.get("domain", "unknown")
            context = request.input.get("context")
            # CAUTION: 'domain' is for logging/telemetry only. Do not branch logic based on it.

            logger.info(
                "signal_inference_request",
                extra={
                    "domain": domain,
                    "text_length": len(text),
                    "existing_signals": existing_signals,
                },
            )

            # 2. Call LLM (In-place for now, assumed OpenAI client is available via env or shared util)
            # Using direct OpenAI import as seen in llm_agent.py for consistency
            from openai import OpenAI

            client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

            system_prompt = f"""
You are a Cognitive Signal Inference Engine.
Your goal is to:
1) detect ONLY the following specific cognitive signals from user comments
2) classify the overall engagement intent
3) classify the comment into one of these buckets: high intent, mid intent, low intent, junk

ALLOWED SIGNALS (Strict Enum):
- VALUE_EVALUATION: User is assessing worth/price/value.
- COST_BENEFIT_HESITATION: User sees value but doubts if it justifies the cost/effort.
- UTILIZATION_DOUBT: User doubts they will use the product enough to justify it.
- EXCESS_CAPABILITY: User feels the product does too much (overkill).
- CONTEXT_FIT_EVALUATION: User is checking if it fits their specific situation/routine.

ALLOWED INTENT_HINT ENUM:
- NOISE
- UNKNOWN
- PRODUCT_INQUIRY
- PROBLEM_SOLUTION
- FIT_SUITABILITY
- LATENT_PURCHASE
- POST_PURCHASE_REGRET

ALLOWED INTENT_CATEGORY ENUM:
- high intent
- mid intent
- low intent
- junk

INTENT_CATEGORY GUIDE:
- high intent: direct purchase interest, explicit product/routine request, strong problem-solving ask, recommendation request.
- mid intent: relevant information seeking, suitability/usage/clarification questions, topical asks that are not yet strongly commercial.
- low intent: related reaction, opinion, anecdote, weak curiosity, or non-actionable topical discussion.
- junk: pure praise, emoji-only, greetings, hostile remarks, or clearly off-topic chatter.

RULES:
1. Output JSON only. format: {{
   "signals": [{{ "type": "SIGNAL_NAME", "confidence": 0.0-1.0 }}],
   "intent_hint": "ENUM_VALUE",
   "intent_category": "ENUM_VALUE",
   "intent_confidence": 0.0-1.0,
   "explanation": "string"
}}
2. If NO allowed signals are clearly present, return empty list.
3. Be conservative. Only output signal items if confidence > 0.5.
4. Ignore explicit feature requests or generic praise (that is for other systems).
5. Focus on the *cognitive process* of evaluation/hesitation.
6. For intent_hint, classify the overall buyer intent even when signal list is empty.
7. Use the model judgment first. Do not assume exact phrase matches are required.
8. If intent_category is high intent or mid intent, prefer a specific non-NOISE commerce intent whenever the text supports it.
"""
            user_prompt = f"""
Input Text: "{text}"
Existing Signals: {existing_signals}

Analyze for cognitive signals.
"""
            response = client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                temperature=0.0,  # Strict determinism
                response_format={"type": "json_object"},
            )

            raw_content = response.choices[0].message.content
            parsed = json.loads(raw_content)

            # 3. Validate & Filter
            signals_out = []
            valid_types = {s.value for s in SignalType}

            for s in parsed.get("signals", []):
                s_type = s.get("type")
                conf = s.get("confidence", 0.0)

                if s_type in valid_types and conf > 0.5:
                    signals_out.append(
                        InferredSignal(type=SignalType(s_type), confidence=conf)
                    )

            explanation = parsed.get("explanation", "No explanation provided")
            intent_hint_raw = parsed.get("intent_hint")
            intent_category_raw = parsed.get("intent_category")
            intent_confidence_raw = parsed.get("intent_confidence")
            intent_hint: Optional[IntentHint] = None
            intent_category: Optional[IntentCategory] = None
            intent_confidence: Optional[float] = None

            valid_intents = {i.value for i in IntentHint}
            if isinstance(intent_hint_raw, str) and intent_hint_raw in valid_intents:
                intent_hint = IntentHint(intent_hint_raw)

            valid_categories = {i.value for i in IntentCategory}
            if (
                isinstance(intent_category_raw, str)
                and intent_category_raw.strip().lower() in valid_categories
            ):
                intent_category = IntentCategory(intent_category_raw.strip().lower())

            if isinstance(intent_confidence_raw, (int, float)):
                intent_confidence = max(0.0, min(float(intent_confidence_raw), 1.0))

            if self._should_resolve_lead_intent(intent_category, intent_hint):
                resolved_hint, resolved_confidence, resolved_explanation = (
                    self._resolve_lead_intent_with_openai(
                        client, text, existing_signals, intent_category
                    )
                )
                if resolved_hint:
                    logger.info(
                        "signal_inference_high_value_resolution",
                        extra={
                            "original_intent": intent_hint.value if intent_hint else None,
                            "resolved_intent": resolved_hint.value,
                            "intent_category": intent_category.value,
                        },
                    )
                    intent_hint = resolved_hint
                    intent_confidence = max(
                        resolved_confidence or 0.0,
                        intent_confidence or 0.0,
                        0.72 if intent_category == IntentCategory.MID_INTENT else 0.82,
                    )
                    if resolved_explanation:
                        explanation = f"{explanation} | resolved: {resolved_explanation}"

            # 4. Lead Scoring & Persistence (Phase 30)
            # If context is provided, we evaluate for Buyer Stage and persist LeadOpportunity
            if context and isinstance(context, dict):
                try:
                    # Merge existing signals (from TS classifier) if provided in input
                    # request.input.get("existing_signals") is List[str] usually, but if updated to List[DetectedSignal]...
                    # For now, rely on inferred signals + text.
                    
                    # Convert Pydantic signals to dicts
                    signal_dicts = [s.model_dump() for s in signals_out]
                    
                    # Also consider existing signals if they are structured? 
                    # The current contract says `existing_signals` is List[str] or signals.
                    # We will rely on what we just inferred + raw text.
                    
                    from ai_core.services.lead_scoring_service import LeadScoringService
                    scorer = LeadScoringService()
                    ts_intents = None
                    if intent_hint in self._qualifying_intents():
                        ts_intents = [intent_hint.value]
                    scorer.evaluate_and_persist(
                        text, signal_dicts, context, ts_intents=ts_intents
                    )
                except Exception as e:
                    logger.error(f"Lead scoring failed: {e}")

            result = SignalInferencePayload(
                inferred_signals=signals_out,
                intent_hint=intent_hint,
                intent_category=intent_category,
                intent_confidence=intent_confidence,
                model=self.model,
                explanation=explanation,
            )

            return CapabilityResponse(
                kind="signal_inference", payload=result.model_dump()
            )

        except Exception as e:
            logger.exception("signal_inference_failed")
            return CapabilityResponse(kind="error", payload={"error": str(e)})
