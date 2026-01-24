import logging
import asyncio
import os
import time
from typing import List
from playwright.async_api import Page

from video_detection_engine.models import VideoCandidate
from video_detection_engine.utils.validators import VideoURLNormalizer

logger = logging.getLogger(__name__)

class TikTokSearchNavigator:
    """
    Navigates TikTok Search Results and extracts VideoCandidates.
    """
    
    # Selectors
    RESULT_VIDEO_ITEM = 'div[data-e2e="search_video-item"]'
    
    def __init__(self, page: Page):
        self.page = page

    async def search_and_extract(self, search_url: str, max_results: int = 5) -> List[VideoCandidate]:
        logger.info(f"Navigating to Search: {search_url}")
        
        try:
            await self.page.goto(search_url, wait_until="domcontentloaded", timeout=45000)
            
            # === DESKTOP DISCOVERY LOGIC ===
            # We are now on /search/video?q=...
            
            try:
                logger.info("Waiting for video results (Desktop Mode)...")
                # Wait for at least one video anchor (15s timeout)
                # Selector: a[href*="/video/"] implies we successfully loaded the video list.
                await self.page.wait_for_selector('a[href*="/video/"]', timeout=15000)
                
                # Extract
                anchors = await self.page.locator('a[href*="/video/"]').all()
                count = len(anchors)
                logger.info(f"Found {count} video anchors.")
                
                if count == 0:
                   raise Exception("0 video anchors found.")
                   
                # Deduplicate
                seen_urls = set()
                candidates = []
                for anchor in anchors:
                    href = await anchor.get_attribute("href")
                    if href and "/video/" in href:
                        if "?" in href: href = href.split("?")[0]
                        seen_urls.add(href)
                        
                logger.info(f"Extracted {len(seen_urls)} unique video URLs.")
                
                for url in seen_urls:
                    # Simple Candidate Creation
                    # Metadata extraction is deferred to the detailed extractor/downloader
                    candidates.append(VideoCandidate(
                        url=url, 
                        platform="tiktok", 
                        metadata={}
                    ))
                    
                return candidates

            except Exception as e:
                logger.warning(f"Search failed or timed out: {e}")
                
                 # === DEBUG PROOF ARTIFACTS ===
                try:
                    ts = int(time.time())
                    safe_name = f"search_fail_{ts}"
                    
                    # Determine Artifact Directory
                    # Priority: Env Var > Default (~/screenshots)
                    home = os.path.expanduser("~")
                    default_path = os.path.join(home, "screenshots")
                    artifact_dir = os.environ.get("DEBUG_ARTIFACTS_DIR", default_path)
                    
                    # Ensure directory exists
                    try:
                        os.makedirs(artifact_dir, exist_ok=True)
                    except Exception as e:
                        # Fallback to tmp if permission denied or other error
                        logger.error(f"Failed to create artifact dir {artifact_dir}: {e}")
                        artifact_dir = "/tmp"

                    screenshot_path = os.path.join(artifact_dir, f"tiktok_{safe_name}.png")
                    html_path = os.path.join(artifact_dir, f"tiktok_{safe_name}.html")
                    
                    await self.page.screenshot(path=screenshot_path, full_page=True)
                    html = await self.page.content()
                    with open(html_path, "w", encoding="utf-8") as f:
                        f.write(html)
                    
                    # Safe check for anchor count in debug
                    anchor_count = await self.page.locator('a[href*="/video/"]').count()
                    logger.warning("SEARCH DEBUG | title=%s url=%s screenshot=%s html=%s anchor_count=%s", 
                        await self.page.title(), self.page.url, screenshot_path, html_path, anchor_count)
                except Exception as dbg_e:
                    logger.error("SEARCH DEBUG failed: %s", dbg_e)
                
                return []
                
        except Exception as e:
            logger.error(f"Search navigation fatal error: {e}")
            return []
