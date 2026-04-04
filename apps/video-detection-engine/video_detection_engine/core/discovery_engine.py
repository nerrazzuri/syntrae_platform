import logging
import asyncio
from typing import Dict, Any, List

from video_detection_engine.browser.controller import BrowserController
from video_detection_engine.integration.client import IntegrationClient
from video_detection_engine.behavior.enforcer import PolicyEnforcer
from video_detection_engine.behavior.search_query_builder import SearchQueryBuilder
from video_detection_engine.behavior.search_navigator import TikTokSearchNavigator
from video_detection_engine.platforms.tiktok import TikTokAdapter
from video_detection_engine.platforms.xiaohongshu import XiaohongshuPlatform
from video_detection_engine.models import VideoDiscoveryDecision, VideoCandidate
from video_detection_engine.utils.validators import VideoPageValidator

logger = logging.getLogger(__name__)

class DiscoveryEngine:
    """
    Orchestrates the Search-Driven Discovery Pipeline.
    1. Query Build -> 2. Search -> 3. Score -> 4. Decide -> 5. Extract -> 6. Emit
    """
    
    def __init__(
        self,
        controller: BrowserController | None,
        client: IntegrationClient,
        run_id: str,
        brand_id: str,
        enforcer: PolicyEnforcer,
        platform: str = "tiktok",
        xhs_session_path: str | None = None,
    ):
        self.controller = controller
        self.client = client
        self.run_id = run_id
        self.brand_id = brand_id  # FIX: Added missing brand_id for stats persistence
        self.enforcer = enforcer
        self.platform = platform
        self.xhs_session_path = xhs_session_path
        # WF-3.1: Track systemic failures for run integrity
        self.error_count = 0
        self.error_threshold = 5  # Abort run if 5+ ERRORs encountered
        self.search_candidates = 0
        self.search_valid_decisions = 0
        self.url_accepted = False
        
        # P1-B: Emission accounting (per-run totals)
        self.total_captured = 0
        self.total_emitted_success = 0
        self.total_emitted_failed = 0
        self.emission_error_classes = []  # Track unique error types
        self.duplicate_suppressed = 0
        self.video_cooldown_suppressed = 0
        self.videos_skipped_cooldown = 0

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

        if self.platform in {"xiaohongshu", "rednote", "xhs"}:
            # Phase-1 Xiaohongshu Adapter Branch
            try:
                platform_adapter = XiaohongshuPlatform(self.xhs_session_path)
                keywords = qb.build_queries(limit=3)
                all_results = []
                seen_pairs = set()

                for keyword in keywords:
                    results = await platform_adapter.run_search(
                        self.controller.page if self.controller else None,
                        keyword,
                        is_video_eligible=lambda note_id: self.client.check_video_eligibility(note_id, "rednote")
                    )

                    for item in results or []:
                        dedup_key = (item.get("video_id"), item.get("referral_comment_id"))
                        if dedup_key in seen_pairs:
                            continue
                        seen_pairs.add(dedup_key)
                        all_results.append(item)

                # Emit to pipeline
                if all_results:
                    self.total_captured = len(all_results)
                    self.search_valid_decisions = len(all_results)
                    self.url_accepted = True

                    success_count, failed_count, error_classes, ingest_status_counts = await self.client.emit_batch(all_results, self.run_id)

                    self.total_emitted_success += success_count
                    self.total_emitted_failed += failed_count
                    self.duplicate_suppressed += ingest_status_counts.get("DUPLICATE_SUPPRESSED", 0)
                    self.video_cooldown_suppressed += ingest_status_counts.get("VIDEO_COOLDOWN_SUPPRESSED", 0)

                    logger.info(
                        f"Xiaohongshu Emission: "
                        f"{success_count} success, {failed_count} failed "
                    )
                
            except Exception as e:
                logger.error(f"Xiaohongshu Discovery Failed: {e}")
                self.error_count += 1
                
            return

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
                    eligibility = await self.client.check_video_eligibility(cand.video_id, cand.platform)
                    if not eligibility.get("eligible", True):
                        self.videos_skipped_cooldown += 1
                        logger.info(
                            "SKIP: %s blocked by cooldown until %s",
                            cand.video_id,
                            eligibility.get("cooldown_until")
                        )
                        await self.client.record_discovery(self.run_id, {
                            "video_id": cand.video_id,
                            "video_url": cand.video_url,
                            "platform": cand.platform,
                            "decision": "SKIP",
                            "market_score": decision_payload.get("market_score"),
                            "reasons": [eligibility.get("reason", "VIDEO_COOLDOWN_ACTIVE")],
                            "evaluation_performed": False
                        })
                        continue

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

            # 3. P1-A: Policy Enforcement BEFORE Comment Extraction
            # Check if policy allows comment capture
            can_capture = self.enforcer.check_comment_limit_gate(current_video_comments=0)
            if not can_capture:
                policy_reason = f"Policy limit reached: {self.enforcer.comments_processed}/{self.enforcer.max_comments_ph} hourly"
                logger.warning(f"🛑 P1-A: Comment capture STOPPED by policy for {cand.video_id}. {policy_reason}")
                # NOT an error - graceful policy stop
                # Policy stops are non-fatal, partial capture allowed
                return
            
            # Calculate allowed comment count based on policy caps
            remaining_hourly = self.enforcer.max_comments_ph - self.enforcer.comments_processed
            max_allowed_this_video = min(self.enforcer.max_comments_pv, remaining_hourly)
            
            if max_allowed_this_video <= 0:
                logger.warning(f"🛑 P1-A: No comments allowed for {cand.video_id} (hourly quota exhausted)")
                return
            
            logger.info(f"P1-A: Extracting up to {max_allowed_this_video} comments for {cand.video_id}")
            
            # 4. Extract Comments (Policy-Limited)
            adapter = TikTokAdapter(self.controller.page)
            # extract_comments navigates by default if url passed, but we already navigated.
            # Passing None as url implies use current page (and skip nav).
            # Pass policy-calculated limit
            comments = await adapter.extract_comments(video_url=None, max_comments=max_allowed_this_video) 
            
            # 5. P1-A: Track captured comments in policy state
            captured_count = len(comments) if comments else 0
            for _ in range(captured_count):
                self.enforcer.track_comment()
            
            logger.info(f"P1-A: Captured {captured_count} comments (total: {self.enforcer.comments_processed}/{self.enforcer.max_comments_ph})")
            
            # 6. P1-B: Emit with Accounting
            if comments:
                # P1-B: Track captured count
                self.total_captured += captured_count
                
                # Augment with candidate metadata including video_id for STRICT VALIDATION
                for c in comments:
                    if not c.get("caption"):
                        c["caption"] = cand.caption
                    # MUST set video_id for Ingestion Strict Validation
                    if not c.get("video_id") or c.get("video_id") == "unknown":
                        c["video_id"] = cand.video_id
                
                # P1-B: Emit and capture results
                success_count, failed_count, error_classes, ingest_status_counts = await self.client.emit_batch(comments, self.run_id)
                
                # P1-B: Update run-level counters
                self.total_emitted_success += success_count
                self.total_emitted_failed += failed_count
                self.duplicate_suppressed += ingest_status_counts.get("DUPLICATE_SUPPRESSED", 0)
                self.video_cooldown_suppressed += ingest_status_counts.get("VIDEO_COOLDOWN_SUPPRESSED", 0)
                for error_class in error_classes:
                    if error_class not in self.emission_error_classes:
                        self.emission_error_classes.append(error_class)
                
                # P1-B: Log emission outcome
                logger.info(
                    f"P1-B: Emission for {cand.video_id}: "
                    f"{success_count} success, {failed_count} failed "
                    f"(run totals: {self.total_emitted_success}S/{self.total_emitted_failed}F of {self.total_captured} captured)"
                )
                
                # P1-B: Handle emission failures
                if failed_count > 0:
                    failure_rate = failed_count / captured_count
                    if failure_rate >= 0.5:  # 50%+ failed
                        logger.error(
                            f"P1-B: CRITICAL emission failure for {cand.video_id}: "
                            f"{failed_count}/{captured_count} failed. Error classes: {set(error_classes)}"
                        )
                        await self.client.update_run_internal(
                            run_id=self.run_id,
                            status="DEGRADED",
                            abort_reason=f"EMISSION_FAILURE_{error_classes[0] if error_classes else 'UNKNOWN'}"
                        )
                    elif failed_count >= 5:  # Absolute count threshold
                        logger.warning(
                            f"P1-B: Significant emission failures for {cand.video_id}: "
                            f"{failed_count} failed. Error classes: {set(error_classes)}"
                        )
                
                # P1-A: Respect pacing config (cooldown + jitter)
                await self.enforcer.pace_action("comment_capture")
            
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
        stats = {
            "videos_processed": self.search_valid_decisions + (1 if self.url_accepted else 0),
            "comments_captured": self.total_captured,
            "comments_emitted_success": self.total_emitted_success,
            "comments_emitted_failed": self.total_emitted_failed,
            "duplicate_suppressed": self.duplicate_suppressed,
            "video_cooldown_suppressed": self.video_cooldown_suppressed,
            "videos_skipped_cooldown": self.videos_skipped_cooldown,
        }
        await self.client.update_run_stats(self.run_id, self.brand_id, stats)

        logger.warning(
            f"[FINALIZE] run={self.run_id} "
            f"search_valid={self.search_valid_decisions} "
            f"url_accepted={self.url_accepted} "
            f"errors={self.error_count} "
            f"P1-B: captured={self.total_captured} "
            f"emitted_success={self.total_emitted_success} "
            f"emitted_failed={self.total_emitted_failed}"
        )
        
        # P1-B: CRITICAL - Captured ≠ Emitted
        # Cannot report success if captured comments failed to emit
        if self.total_captured > 0 and self.total_emitted_success == 0:
            await self.client.update_run_internal(
                self.run_id, 
                "FAILED", 
                f"P1-B: ZERO_SUCCESSFUL_EMISSIONS (captured={self.total_captured}, all failed)"
            )
            return
        
        # P1-B: Major emission failure (>30% failed)
        if self.total_captured > 0:
            emission_failure_rate = self.total_emitted_failed / self.total_captured
            if emission_failure_rate > 0.3:
                error_summary = ", ".join(set(self.emission_error_classes[:3]))  # Top 3 unique
                await self.client.update_run_internal(
                    self.run_id,
                    "DEGRADED",
                    f"P1-B: HIGH_EMISSION_FAILURE_RATE ({self.total_emitted_failed}/{self.total_captured}, errors: {error_summary})"
                )
                return
        if self.search_valid_decisions == 0 and not self.url_accepted:
            await self.client.update_run_internal(self.run_id, "DEGRADED", "SEARCH_NO_VALID_CANDIDATES")
            return

        if self.error_count > 0:
            await self.client.update_run_internal(self.run_id, "DEGRADED", "NON_FATAL_ERRORS")
            return

        await self.client.update_run_internal(self.run_id, "COMPLETED", None)
