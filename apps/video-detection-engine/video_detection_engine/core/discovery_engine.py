import logging
import asyncio
from typing import Dict, Any, List

from video_detection_engine.browser.controller import BrowserController
from video_detection_engine.integration.client import IntegrationClient
from video_detection_engine.behavior.enforcer import PolicyEnforcer
from video_detection_engine.behavior.search_query_builder import SearchQueryBuilder
from video_detection_engine.behavior.search_navigator import TikTokSearchNavigator
from video_detection_engine.platforms.tiktok import TikTokAdapter
from video_detection_engine.models import VideoDiscoveryDecision, VideoCandidate
from video_detection_engine.utils.validators import VideoPageValidator

logger = logging.getLogger(__name__)

class DiscoveryEngine:
    """
    Orchestrates the Search-Driven Discovery Pipeline.
    1. Query Build -> 2. Search -> 3. Score -> 4. Decide -> 5. Extract -> 6. Emit
    """
    
    def __init__(self, controller: BrowserController, client: IntegrationClient, run_id: str, enforcer: PolicyEnforcer):
        self.controller = controller
        self.client = client
        self.run_id = run_id
        self.enforcer = enforcer
        # WF-3.1: Track systemic failures for run integrity
        self.error_count = 0
        self.error_threshold = 5  # Abort run if 5+ ERRORs encountered
        self.search_candidates = 0
        self.search_valid_decisions = 0
        self.url_accepted = False

    async def execute(self, market_profile: Dict[str, Any], finalize: bool = True):
        """
        Main Execution Loop.
        """
        logger.info("Starting Discovery Execution...")
        
        # 1. Build Queries
        qb = SearchQueryBuilder(market_profile)
        search_urls = qb.build_search_urls(limit=3) # Configurable limit
        
        if not search_urls:
            self.search_candidates = 0
            self.search_valid_decisions = 0
            logger.warning("No valid search queries generated. Aborting.")
            return

        logger.info(f"Generated {len(search_urls)} search queries.")

        # 2. Search Loop
        for url in search_urls:
            # Pacing
            await self.enforcer.pace_action("navigation")
            
            # Navigate & Extract Candidates
            navigator = TikTokSearchNavigator(self.controller.page)
            candidates = await navigator.search_and_extract(url, max_results=5)
            self.search_candidates += len(candidates)
            
            logger.info(f"Found {len(candidates)} candidates from {url}")
            
            for cand in candidates:
                # Check Global Gates
                if not self.enforcer.check_video_limit_gate():
                    logger.info("Global video limit reached. Stopping discovery.")
                    return

                # 3. Score & Decide
                decision_payload = await self._score_candidate(cand, market_profile)

                if decision_payload["decision"] != "ERROR":
                    self.search_valid_decisions += 1

                if decision_payload["decision"] == "ERROR":
                    error_class = decision_payload.get("error_class")
                    http_status = decision_payload.get("http_status")

                    logger.error(
                        f"WF-3.1: System ERROR for {cand.video_id} "
                        f"error_class={error_class} http_status={http_status}"
                    )

                    # Always persist ERROR
                    await self.client.record_discovery(self.run_id, decision_payload)

                    # --- WF-3.1 RUN INTEGRITY ENFORCEMENT ---
                    FATAL_ERRORS = {
                        "AI_CORE_HTTP_403",
                        "AI_CORE_HTTP_404",
                        "AI_CORE_HTTP_409",
                        "AI_CORE_CONTRACT",
                    }

                    if error_class in FATAL_ERRORS:
                        logger.error("WF-3.1: Fatal system failure → FAIL run")

                        if finalize:
                            await self.client.update_run_internal(
                                run_id=self.run_id,
                                status="FAILED",
                                abort_reason=error_class,
                            )

                            # HARD STOP — no continue
                            raise RuntimeError("Fatal system failure")

                    # Transient/systemic but not fatal
                    self.error_count += 1

                    if self.error_count >= self.error_threshold:
                        logger.error(
                            f"WF-3.1: ERROR threshold exceeded ({self.error_count}) → DEGRADED"
                        )

                        if finalize:
                            await self.client.update_run_internal(
                                run_id=self.run_id,
                                status="DEGRADED",
                                abort_reason=f"{error_class}_THRESHOLD",
                            )

                        return

                    # Otherwise: tolerate and move on
                    continue
                
                # Extract decision for conditional logic
                decision = decision_payload["decision"]
                
                # WF-3.1: Obey ACCEPT/REJECT/SKIP decision
                if decision == "ACCEPT":
                    logger.info(f"ACCEPT: {cand.video_id} (score={decision_payload.get('market_score', 0)})")
                    # WF-3.1: Persistence-required-for-ACCEPT
                    try:
                        await self.client.record_discovery(self.run_id, decision_payload)
                    except Exception as e:
                        logger.error(f"WF-3.1 FATAL: ACCEPT persistence failed: {e}")
                        
                        if finalize:
                            await self.client.update_run_internal(
                                run_id=self.run_id,
                                status="FAILED",
                                abort_reason="ACCEPT_PERSISTENCE_FAILED",
                            )

                        raise
                    
                    # Process (Nav -> Validate -> Extract -> Emit)
                    await self._process_accepted_video(cand)
                    # Track usage
                    self.enforcer.track_video()
                    
                elif decision == "REJECT":
                    # WF-3.1: REJECT increments reject stats
                    logger.info(f"REJECT: {cand.video_id} (score={decision_payload.get('market_score', 0)})")
                    await self.client.record_discovery(self.run_id, decision_payload)
                    self.enforcer.track_reject()  # Track rejection
                    
                elif decision == "SKIP":
                    # WF-3.1: SKIP is neutral - does NOT count as rejection
                    logger.info(f"SKIP: {cand.video_id} (score={decision_payload.get('market_score', 0)}) - neutral")
                    await self.client.record_discovery(self.run_id, decision_payload)
                    # No stats tracking for SKIP
                    
                else:
                    logger.warning(f"Unknown decision '{decision}' for {cand.video_id}")

    async def _score_candidate(self, cand: VideoCandidate, profile: Dict[str, Any]) -> Dict[str, Any]:
        """
        WF-3.1: Evaluates a candidate against AI Core Market Scoring using automation_run_id.
        Returns standardized decision payload with provenance correctness.
        """
        # Construct text representation for scoring (Caption + Hashtags)
        text_content = f"{cand.caption or ''} {' '.join(cand.hashtags)}"
        
        try:
            # WF-3.1: Call AI Core with automation_run_id
            result = await self.client.score_content(
                automation_run_id=self.run_id,
                text=text_content, 
                hashtags=cand.hashtags,
                video_id=cand.video_id,
                video_url=cand.video_url
            )
        except Exception as e:
            return {
                "decision": "ERROR",
                "evaluation_performed": False,
                "error_class": "AI_CORE_EXCEPTION",
                "http_status": None,
                "reasons": [str(e)],
            }
        
        # WF-3.1: Extract decision and evaluation status
        decision = result.get("decision", "ERROR")
        score = result.get("score")
        reasons = result.get("reasons", [])
        evaluation_performed = result.get("evaluation_performed", False)
        error_class = result.get("error_class")
        http_status = result.get("http_status")
        
        # WF-3.1: Provenance correctness - only claim profile evaluation if actually performed
        base_payload = {
             "video_id": cand.video_id,
             "video_url": cand.video_url,
             "platform": cand.platform,
             "market_score": score,
             "decision": decision,
             "reasons": [r.get("detail", str(r)) if isinstance(r, dict) else str(r) for r in reasons],
             "evaluation_performed": evaluation_performed,
             "error_class": error_class,
             "http_status": http_status
        }
        
        # Only attach market profile provenance if evaluation was actually performed
        if evaluation_performed and decision != "ERROR":
            base_payload["market_profile_id"] = profile.get("id")
            base_payload["market_profile_version"] = profile.get("version")
        
        return base_payload
    
    async def _mark_run_failed(self, reason: str):
        logger.error(f"Marking run {self.run_id} as FAILED: {reason}")

        await self.client.update_run_internal(
            run_id=self.run_id,
            status="FAILED",
            abort_reason=reason,
        )

    async def _process_accepted_video(self, cand: VideoCandidate):
        try:
            # 1. Navigate
            await self.controller.navigate(cand.video_url)
            
            # 2. Validate Page (Strict)
            is_valid, reason = await VideoPageValidator.validate(self.controller.page)
            if not is_valid:
                logger.error(f"WF-3.1: ACCEPTED video failed validation: {reason}")

                await self.client.update_run_internal(
                    run_id=self.run_id,
                    status="DEGRADED",
                    abort_reason="ACCEPT_PROCESSING_FAILED",
                )

                raise Exception("Accepted video failed validation")

            # 3. Extract Comments (Strict)
            adapter = TikTokAdapter(self.controller.page)
            # extract_comments navigates by default if url passed, but we already navigated.
            # Passing None as url implies use current page (and skip nav).
            comments = await adapter.extract_comments(video_url=None) 
            
            # 4. Emit
            if comments:
                # Augment with candidate metadata including video_id for STRICT VALIDATION
                for c in comments:
                    if not c.get("caption"):
                        c["caption"] = cand.caption
                    # MUST set video_id for Ingestion Strict Validation
                    if not c.get("video_id") or c.get("video_id") == "unknown":
                        c["video_id"] = cand.video_id
                        
                await self.client.emit_batch(comments, self.run_id)
                logger.info(f"Emitted {len(comments)} events for {cand.video_id}")
            
        except Exception as e:
            logger.error(f"Processing failed for {cand.video_id}: {e}")
            # Raise if we want to kill the whole run? 
            # Plan said: "Hard Fail extraction".
            # TikTokAdapter raises CommentExtractionError. 
            # We should catch it here or let it propagate.
            # "Run must ABORT if 0 real comments".
            # So we should re-raise critical errors.
            raise e 
    
    async def finalize_run(self):
        logger.warning(
            f"[FINALIZE] run={self.run_id} "
            f"search_valid={self.search_valid_decisions} "
            f"url_accepted={self.url_accepted} "
            f"errors={self.error_count}"
        )
        if self.search_valid_decisions == 0 and not self.url_accepted:
            await self.client.update_run_internal(self.run_id, "DEGRADED", "SEARCH_NO_VALID_CANDIDATES")
            return

        if self.error_count > 0:
            await self.client.update_run_internal(self.run_id, "DEGRADED", "NON_FATAL_ERRORS")
            return

        await self.client.update_run_internal(self.run_id, "COMPLETED", None)