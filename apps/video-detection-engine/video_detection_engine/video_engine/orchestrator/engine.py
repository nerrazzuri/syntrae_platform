import datetime
import time
import logging
import hashlib # Fix 4
from typing import List, Optional

from .schemas import (
    EngagementEvent, OrchestrationResult, OrchestrationStatus, PhaseResult, DeliveryMode,
    EngagementDecisionType # Fix 5
)

# Phase Engines
from ..intent.engine import CommentIntentEngine as IntentEngine # P4
from ..rag.engine import RAGResponseEngine # Phase 5 (Knowledge Selection)
# from ..rag_gateway.schemas import RetrieveRequest, ContentRequest (Used inside P5 now)
from ..policy.engine import EngagementPolicyEngine # P6
from ..policy.enforcement import EnforcementEngine # P7
from ..policy.schemas import EngagementDecision, DecisionType
from ..safety.engine import RiskScoringEngine as SafetyEngine # P7
from ..safety.schemas import RiskSignals # Needed for P7 Input
from ..generation.engine import MessageGenerationEngine # P8
from ..generation.schemas import GenerationMode
from ..delivery.engine import DeliveryEngine # P9
from ..delivery.schemas import DeliveryStatus
from ..core.schemas import DetectionResult, SignalTrace 

# Schemas needed for inter-phase communication
from ..rag.schemas import ResponsePlan, ResponseCandidate, ResponseType
from ..intent.schemas import CommentData, IntentType

logger = logging.getLogger(__name__)

class EngagementOrchestrator:
    """
    Phase X: The Single Authoritative Runtime Controller.
    Strictly follows: P4 -> P5 -> P6 -> P7 -> P8 -> P9.
    Immutability: Run record is Append-Only.
    Fail-Closed: Any Exception -> Abort.
    """

    def __init__(self, 
                 intent_engine: IntentEngine,
                 rag_engine: RAGResponseEngine, # Phase 5 Engine
                 policy_engine: EngagementPolicyEngine,
                 safety_engine: SafetyEngine,
                 enforcement_engine: EnforcementEngine,
                 generation_engine: MessageGenerationEngine,
                 delivery_engine: DeliveryEngine):
        
        self.intent = intent_engine
        self.knowledge = rag_engine # Renamed from self.rag to indicate it's the Knowledge Engine
        self.policy = policy_engine
        self.safety = safety_engine
        self.enforcement = enforcement_engine
        self.generation = generation_engine
        self.delivery = delivery_engine

    def process_event(self, event: EngagementEvent) -> OrchestrationResult:
        start_time = datetime.datetime.now()
        run_record = OrchestrationResult(
            trace_id=event.trace_id,
            tenant_id=event.tenant_id,
            platform=event.platform,
            comment_id=event.comment_id,
            start_time=start_time,
            final_status=OrchestrationStatus.FAILED 
        )
        
        try:
            # --- Phase Prep ---
            # Fix 1: Use Input Detection Result (No Fabrication)
            if not event.detection:
                 raise ValueError("Missing DetectionResult in EngagementEvent")
            
            detection = event.detection

            # --- Phase 4: Intent ---
            p4_start = time.perf_counter()
            comment_data = CommentData(
                text=event.comment_text,
                id=event.comment_id,
                author_id=event.comment_author_id,
                created_at=datetime.datetime.now()
            )
            
            intent_res = self.intent.process(comment_data, detection)
            
            run_record.phase_history.append(PhaseResult(
                phase_name="Phase 4: Intent",
                status="success",
                output_summary={"type": intent_res.intent_type.value},
                duration_ms=(time.perf_counter() - p4_start) * 1000
            ))
            
            if not intent_res.is_actionable:
                run_record.final_status = OrchestrationStatus.SKIPPED
                run_record.decision = EngagementDecisionType.SKIP # Fix 5
                return self._finalize(run_record)

            # --- Phase 5: Knowledge Selection (RAG Engine) ---
            p5_start = time.perf_counter()
            # Fix 2: Use Input Token (No Fabrication)
            token_p5 = event.rag_access_token
            
            try:
                # Fix 3: Delegate to Phase 5 Engine
                plan = self.knowledge.process(
                    comment=comment_data,
                    detection=detection,
                    intent=intent_res,
                    token=token_p5,
                    language=event.video_context.language,
                    trace_id=event.trace_id # Propagate Trace ID
                )
            except Exception as e:
                # Fail Closed
                raise e

            run_record.phase_history.append(PhaseResult(
                phase_name="Phase 5: Knowledge",
                status="success",
                output_summary={"candidates": len(plan.candidates)},
                duration_ms=(time.perf_counter() - p5_start) * 1000
            ))

            # --- Phase 6: Planning ---
            p6_start = time.perf_counter()
            policy_dec = self.policy.process(
                comment_data, 
                detection, 
                intent_res, 
                plan, 
                event.comment_author_id, 
                event.video_id
            )
            
            run_record.phase_history.append(PhaseResult(
                phase_name="Phase 6: Planning",
                status="success",
                output_summary={"decision": policy_dec.decision.value},
                duration_ms=(time.perf_counter() - p6_start) * 1000
            ))

            # --- Phase 7: Enforcement ---
            p7_start = time.perf_counter()
            # Construct RiskSignals for SafetyEngine
            risk_signals = RiskSignals(
                duplicate_comment_rate=0.0, 
                link_spam_score=0.0
            )
            
            safety_dec = self.safety.process(
                policy_dec, 
                event.comment_author_id,
                event.video_id,
                risk_signals
            )
            
            enforce_dec = self.enforcement.process(policy_dec, safety_dec, plan)
            
            run_record.phase_history.append(PhaseResult(
                phase_name="Phase 7: Enforcement",
                status="success",
                output_summary={"decision": enforce_dec.decision.value, "risk": enforce_dec.risk_level},
                duration_ms=(time.perf_counter() - p7_start) * 1000
            ))
            
            if enforce_dec.decision in [DecisionType.DENY, DecisionType.DEFER]:
                run_record.final_status = OrchestrationStatus.BLOCKED
                run_record.decision = EngagementDecisionType.BLOCK # Fix 5
                return self._finalize(run_record)
            
            run_record.decision = EngagementDecisionType.ENGAGE # Fix 5

            # --- Phase 8: Generation ---
            p8_start = time.perf_counter()
            gen_mode = GenerationMode.REPLY if enforce_dec.engagement_type == "reply" else GenerationMode.DM
            
            gen_res = self.generation.process(
                mode=gen_mode,
                decision=enforce_dec,
                plan=plan, 
                platform_id=event.platform,
                token=event.rag_access_token, # Fix: Pass token for P8 content fetch
                trace_id=event.trace_id # Fix: Pass Match Trace ID
            )
            
            if not gen_res.message_text:
                run_record.phase_history.append(PhaseResult(
                    phase_name="Phase 8: Generation",
                    status="failed",
                    output_summary={"flags": gen_res.safety_flags},
                    duration_ms=(time.perf_counter() - p8_start) * 1000
                ))
                run_record.final_status = OrchestrationStatus.FAILED
                return self._finalize(run_record)

            run_record.phase_history.append(PhaseResult(
                phase_name="Phase 8: Generation",
                status="success",
                output_summary={"len": len(gen_res.message_text)},
                duration_ms=(time.perf_counter() - p8_start) * 1000
            ))

            # --- Phase 9: Delivery ---
            p9_start = time.perf_counter()
            
            # --- Fix Delivery Idempotency Recipient Logic ---
            delivery_channel = "COMMENT_REPLY" if gen_mode == GenerationMode.REPLY else "DM"
            
            recipient_id = None
            if delivery_channel == "COMMENT_REPLY":
                recipient_id = event.comment_id
                if not recipient_id:
                     raise ValueError("Missing Required Field: comment_id for REPLY")
            elif delivery_channel == "DM":
                recipient_id = event.comment_author_id
                if not recipient_id:
                     raise ValueError("Missing Required Field: comment_author_id for DM")
            
            if not recipient_id: 
                 raise ValueError("Could not derive recipient_id")
                 
            # Construct Idempotency Key
            raw_key_parts = [
                event.trace_id,
                event.platform,
                delivery_channel,
                recipient_id
            ]
            raw_key = ":".join(raw_key_parts)
            idempotency_key = hashlib.sha256(raw_key.encode()).hexdigest()
            
            original_dry_run = self.delivery.config.dry_run_enabled
            if event.delivery_mode == DeliveryMode.DRY_RUN:
                self.delivery.config.dry_run_enabled = True
            
            delivery_res = self.delivery.process(
                event.platform,
                gen_mode,
                gen_res.message_text,
                event.comment_id,
                event.video_id,
                event.comment_author_id,
                idempotency_key
            )
            
            self.delivery.config.dry_run_enabled = original_dry_run
            
            run_record.phase_history.append(PhaseResult(
                phase_name="Phase 9: Delivery",
                status="success" if delivery_res.delivery_status in [DeliveryStatus.SENT, DeliveryStatus.SKIPPED_DRY_RUN] else "failed",
                output_summary={"status": delivery_res.delivery_status.value},
                duration_ms=(time.perf_counter() - p9_start) * 1000
            ))
            
            run_record.delivery_outcome = delivery_res.delivery_status
            
            if delivery_res.delivery_status == DeliveryStatus.FAILED:
                 run_record.final_status = OrchestrationStatus.FAILED
            else:
                 run_record.final_status = OrchestrationStatus.COMPLETED

            return self._finalize(run_record)

        except Exception as e:
            logger.exception("Orchestration Fatal Error")
            run_record.final_status = OrchestrationStatus.FAILED
            run_record.phase_history.append(PhaseResult(
                phase_name="Orchestrator",
                status="failed",
                error=str(e)
            ))
            return self._finalize(run_record)

    def _finalize(self, record: OrchestrationResult) -> OrchestrationResult:
        record.end_time = datetime.datetime.now()
        return record
