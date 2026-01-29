import logging
import asyncio
import os
import time
import random
import urllib.parse
from typing import List, Optional
from playwright.async_api import Page

from video_detection_engine.models import VideoCandidate
from video_detection_engine.utils.validators import VideoURLNormalizer

logger = logging.getLogger(__name__)


class TikTokSearchNavigator:
    """
    Navigates TikTok Search Results and extracts VideoCandidates.
    Implements a stateful, UI-driven search flow to avoid empty results.
    """

    # Selectors
    SEARCH_INPUT = 'input[data-e2e="search-user-input"], input[type="search"], input[placeholder*="Search"]'
    VIDEO_ANCHOR = 'a[href*="/video/"]'
    FEED_VIDEO = 'div[data-e2e="recommend-list-item-container"], div[data-e2e="user-post-item"]'

    # Timing constants
    HOME_URL = "https://www.tiktok.com/"
    WARM_UP_SCROLL_COUNT = 3
    WARM_UP_SCROLL_DELAY = (1.0, 2.0)  # Random range
    TYPING_DELAY = (0.08, 0.15)  # Per character
    HYDRATION_BUDGET_SECONDS = 12
    HYDRATION_SCROLL_WAIT = (1.0, 2.0)

    def __init__(self, page: Page):
        self.page = page

    # -------------------------------------------------------------------------
    # PUBLIC API
    # -------------------------------------------------------------------------

    async def search_and_extract(self, search_url: str, max_results: int = 5) -> List[VideoCandidate]:
        """
        Main entry point. Performs UI-driven search and extracts candidates.
        On failure, returns empty list (no fatal errors).
        """
        # --- ISSUE 1: Explicit Query Extraction ---
        query = self._extract_query_from_url(search_url)
        if not query:
            logger.warning("SEARCH_QUERY_MISSING: Could not parse query from URL: %s", search_url)
            return []
        logger.info("SEARCH_QUERY_EXTRACTED: %s", query)

        try:
            # --- Phase 1: Warm-up ---
            await self._warm_up()

            # --- Phase 2: UI Search ---
            search_success = await self._perform_ui_search(query)
            if not search_success:
                logger.warning("SEARCH_FAILED: UI search did not complete successfully")
                return []

            # --- Phase 3: Hydration ---
            await self._ensure_hydration()

            # --- Phase 4: Extraction ---
            candidates = await self._extract_candidates(max_results)
            logger.info("RESULT_COUNT=%d", len(candidates))
            return candidates

        except Exception as e:
            logger.error("SEARCH_FATAL_ERROR: %s", e)
            await self._capture_debug_artifacts("search_error")
            return []

    # -------------------------------------------------------------------------
    # PHASE 1: WARM-UP
    # -------------------------------------------------------------------------

    async def _warm_up(self) -> None:
        """
        Navigate to TikTok home and scroll to establish session context.
        """
        logger.info("WARM_UP_START")

        try:
            await self.page.goto(self.HOME_URL, wait_until="domcontentloaded", timeout=30000)

            # Wait for page to settle
            await asyncio.sleep(random.uniform(2.0, 4.0))

            # Scroll home feed
            for i in range(self.WARM_UP_SCROLL_COUNT):
                await self.page.mouse.wheel(0, random.randint(400, 800))
                await asyncio.sleep(random.uniform(*self.WARM_UP_SCROLL_DELAY))

            # Idle briefly
            await asyncio.sleep(random.uniform(1.0, 2.0))

        except Exception as e:
            logger.warning("WARM_UP_ERROR: %s", e)

        # --- ISSUE 2: Success Signal Check ---
        warm_up_ok = await self._check_warm_up_success()
        if warm_up_ok:
            logger.info("WARM_UP_OK")
        else:
            logger.warning("WARM_UP_INCOMPLETE: No success signals detected, continuing anyway")

    async def _check_warm_up_success(self) -> bool:
        """
        Verify at least one success signal after warm-up.
        """
        try:
            # Signal 1: Search input visible
            search_count = await self.page.locator(self.SEARCH_INPUT).count()
            if search_count > 0:
                return True

            # Signal 2: Feed video exists
            feed_count = await self.page.locator(self.FEED_VIDEO).count()
            if feed_count > 0:
                return True

            # Signal 3: Page title is meaningful
            title = await self.page.title()
            if title and len(title) > 3 and "tiktok" in title.lower():
                return True

            return False
        except Exception:
            return False

    # -------------------------------------------------------------------------
    # PHASE 2: UI SEARCH
    # -------------------------------------------------------------------------

    async def _perform_ui_search(self, query: str) -> bool:
        """
        Perform search via UI interaction (click input, type, submit).
        """
        try:
            # Find and click search input
            search_input = self.page.locator(self.SEARCH_INPUT).first
            await search_input.wait_for(state="visible", timeout=10000)
            await search_input.click()
            await asyncio.sleep(random.uniform(0.3, 0.6))

            # Clear any existing text
            await self.page.keyboard.press("Control+a")
            await asyncio.sleep(0.1)

            # Type query with realistic delay
            for char in query:
                await self.page.keyboard.type(char, delay=random.uniform(*self.TYPING_DELAY) * 1000)

            await asyncio.sleep(random.uniform(0.5, 1.0))

            # Submit search
            await self.page.keyboard.press("Enter")
            logger.info("SEARCH_SUBMITTED")

            # Wait for navigation/results page
            await asyncio.sleep(random.uniform(2.0, 3.0))

            # Wait for results to start loading
            try:
                await self.page.wait_for_selector(self.VIDEO_ANCHOR, timeout=10000)
            except Exception:
                logger.warning("SEARCH_NO_INITIAL_RESULTS: No video anchors found after submit")
                # Don't fail - hydration may reveal results

            return True

        except Exception as e:
            logger.error("SEARCH_UI_ERROR: %s", e)
            await self._capture_debug_artifacts("search_ui_fail")
            return False

    # -------------------------------------------------------------------------
    # PHASE 3: HYDRATION
    # -------------------------------------------------------------------------

    async def _ensure_hydration(self) -> None:
        """
        Time-budgeted hydration loop to trigger lazy loading.
        """
        logger.info("HYDRATION_START")

        start_time = time.monotonic()
        last_count = 0

        while (time.monotonic() - start_time) < self.HYDRATION_BUDGET_SECONDS:
            # Scroll
            await self.page.mouse.wheel(0, random.randint(600, 1000))
            await asyncio.sleep(random.uniform(*self.HYDRATION_SCROLL_WAIT))

            # Check anchor count
            current_count = await self.page.locator(self.VIDEO_ANCHOR).count()

            if current_count > 0 and current_count > last_count:
                logger.debug("HYDRATION_PROGRESS: count=%d", current_count)
                last_count = current_count

            # Early exit if we have enough results
            if current_count >= 10:
                logger.info("HYDRATION_SUCCESS (count=%d)", current_count)
                return

        # Time budget exhausted
        final_count = await self.page.locator(self.VIDEO_ANCHOR).count()
        if final_count > 0:
            logger.info("HYDRATION_SUCCESS (count=%d)", final_count)
        else:
            logger.warning("HYDRATION_TIMEOUT: No video anchors found within budget")

    # -------------------------------------------------------------------------
    # PHASE 4: EXTRACTION
    # -------------------------------------------------------------------------

    async def _extract_candidates(self, max_results: int) -> List[VideoCandidate]:
        """
        Extract video URLs from search results page.
        """
        try:
            anchors = await self.page.locator(self.VIDEO_ANCHOR).all()
            logger.debug("EXTRACTION: Found %d raw anchors", len(anchors))

            seen_urls = set()
            candidates = []

            for anchor in anchors:
                if len(candidates) >= max_results:
                    break

                try:
                    href = await anchor.get_attribute("href")
                    if not href or "/video/" not in href:
                        continue

                    # Clean URL
                    if "?" in href:
                        href = href.split("?")[0]

                    # Deduplicate
                    if href in seen_urls:
                        continue
                    seen_urls.add(href)

                    # Create candidate
                    candidates.append(VideoCandidate(
                        url=href,
                        platform="tiktok",
                        metadata={}
                    ))

                except Exception as e:
                    logger.debug("EXTRACTION_ITEM_ERROR: %s", e)
                    continue

            return candidates

        except Exception as e:
            logger.error("EXTRACTION_ERROR: %s", e)
            return []

    # -------------------------------------------------------------------------
    # UTILITIES
    # -------------------------------------------------------------------------

    def _extract_query_from_url(self, search_url: str) -> Optional[str]:
        """
        Parse query parameter from TikTok search URL.
        """
        try:
            parsed = urllib.parse.urlparse(search_url)
            params = urllib.parse.parse_qs(parsed.query)
            query_list = params.get("q", [])
            if query_list:
                return query_list[0]
            return None
        except Exception:
            return None

    async def _capture_debug_artifacts(self, prefix: str) -> None:
        """
        Capture screenshot and HTML for debugging.
        """
        try:
            ts = int(time.time())
            safe_name = f"{prefix}_{ts}"

            # Determine artifact directory
            home = os.path.expanduser("~")
            default_path = os.path.join(home, "screenshots")
            artifact_dir = os.environ.get("DEBUG_ARTIFACTS_DIR", default_path)

            try:
                os.makedirs(artifact_dir, exist_ok=True)
            except Exception:
                artifact_dir = "/tmp"

            screenshot_path = os.path.join(artifact_dir, f"tiktok_{safe_name}.png")
            html_path = os.path.join(artifact_dir, f"tiktok_{safe_name}.html")

            await self.page.screenshot(path=screenshot_path, full_page=True)
            html = await self.page.content()
            with open(html_path, "w", encoding="utf-8") as f:
                f.write(html)

            logger.warning(
                "DEBUG_ARTIFACTS: screenshot=%s html=%s url=%s",
                screenshot_path, html_path, self.page.url
            )

        except Exception as e:
            logger.error("DEBUG_ARTIFACT_ERROR: %s", e)
