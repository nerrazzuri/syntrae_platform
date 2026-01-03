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

    async def execute(self, market_profile: Dict[str, Any]):
        """
        Main Execution Loop.
        """
        logger.info("Starting Discovery Execution...")
        
        # 1. Build Queries
        qb = SearchQueryBuilder(market_profile)
        search_urls = qb.build_search_urls(limit=3) # Configurable limit
        
        if not search_urls:
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
            
            logger.info(f"Found {len(candidates)} candidates from {url}")
            
            for cand in candidates:
                # Check Global Gates
                if not self.enforcer.check_video_limit_gate():
                    logger.info("Global video limit reached. Stopping discovery.")
                    return

                # 3. Score & Decide
                decision_payload = await self._score_candidate(cand, market_profile)
                
                # 4. Persist Decision (Audit)
                # Ensure fields match schema requirements
                await self.client.record_discovery(self.run_id, decision_payload)
                
                decision = decision_payload["decision"]
                
                if decision == VideoDiscoveryDecision.ACCEPT:
                    logger.info(f"Accepted Candidate: {cand.video_id}")
                    # 5. Process (Nav -> Validate -> Extract -> Emit)
                    await self._process_accepted_video(cand)
                    
                    # Track usage
                    self.enforcer.track_video()
                else:
                    logger.info(f"Skipped Candidate: {cand.video_id} ({decision})")

    async def _score_candidate(self, cand: VideoCandidate, profile: Dict[str, Any]) -> Dict[str, Any]:
        """
        Evaluates a candidate against AI Core Market Scoring.
        """
        # Construct text representation for scoring (Caption + Hashtags)
        text_content = f"{cand.caption or ''} {' '.join(cand.hashtags)}"
        
        # Call AI Core
        # Note: We are transforming Video Candidate -> Text Content for scoring
        result = await self.client.score_content(text_content, cand.hashtags, cand.platform)
        
        score = result.get("score", 0.0)
        is_match = result.get("is_match", False)
        reasons = result.get("reasons", [])
        
        decision = VideoDiscoveryDecision.ACCEPT if is_match else VideoDiscoveryDecision.REJECT
        
        # Override REJECT to SKIP if reasons imply technical skip or generic low score?
        # For now, strict mapping.
        
        return {
             "video_id": cand.video_id,
             "video_url": cand.video_url,
             "platform": cand.platform,
             "market_score": score,
             "decision": decision,
             "reasons": reasons,
             "market_profile_id": profile.get("id"),
             "market_profile_version": profile.get("version")
        }

    async def _process_accepted_video(self, cand: VideoCandidate):
        try:
            # 1. Navigate
            await self.controller.navigate(cand.video_url)
            
            # 2. Validate Page (Strict)
            is_valid, reason = await VideoPageValidator.validate(self.controller.page)
            if not is_valid:
                logger.error(f"Video Page Validation Failed: {reason}")
                # We ACCEPTED it, but now failed to process. 
                # Ideally update decision to ERROR? For now, we just skip extraction.
                return

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
