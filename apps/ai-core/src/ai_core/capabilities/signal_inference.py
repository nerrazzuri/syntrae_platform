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


class InferredSignal(BaseModel):
    type: SignalType
    confidence: float


class SignalInferencePayload(BaseModel):
    inferred_signals: List[InferredSignal]
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
Your goal is to detect ONLY the following specific cognitive signals from user comments.

ALLOWED SIGNALS (Strict Enum):
- VALUE_EVALUATION: User is assessing worth/price/value.
- COST_BENEFIT_HESITATION: User sees value but doubts if it justifies the cost/effort.
- UTILIZATION_DOUBT: User doubts they will use the product enough to justify it.
- EXCESS_CAPABILITY: User feels the product does too much (overkill).
- CONTEXT_FIT_EVALUATION: User is checking if it fits their specific situation/routine.

RULES:
1. Output JSON only. format: {{ "signals": [ {{ "type": "SIGNAL_NAME", "confidence": 0.0-1.0 }} ], "explanation": "string" }}
2. If NO allowed signals are clearly present, return empty list.
3. Be conservative. Only output if confidence > 0.5.
4. Ignore explicit feature requests or generic praise (that is for other systems).
5. Focus on the *cognitive process* of evaluation/hesitation.
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
            # CAUTION: 'explanation' leaked upstream only for debugging.

            result = SignalInferencePayload(
                inferred_signals=signals_out, model=self.model, explanation=explanation
            )

            return CapabilityResponse(
                kind="signal_inference", payload=result.model_dump()
            )

        except Exception as e:
            logger.exception("signal_inference_failed")
            return CapabilityResponse(kind="error", payload={"error": str(e)})
