import logging
import random
import urllib.parse
import re
from typing import List

logger = logging.getLogger(__name__)

class XHSSearchNavigator:
    @staticmethod
    async def search(page, keyword: str) -> List[str]:
        """
        Navigates to Xiaohongshu search results and extracts up to 5 post URLs.
        Preserves xsec_token query params which are required for direct note access.
        """
        encoded_keyword = urllib.parse.quote(keyword)
        search_url = f"https://www.xiaohongshu.com/search_result?keyword={encoded_keyword}"
        
        logger.info(f"Navigating to search URL: {search_url}")
        
        # 1. Navigate to page
        try:
            # XHS often hangs on domcontentloaded because of tracking pixels, but the SPA renders fine.
            # Catch the timeout so we can still attempt card extraction.
            await page.goto(search_url, wait_until="domcontentloaded", timeout=30000)
        except Exception as e:
            logger.warning(f"Navigation timeout/error (expected randomly on XHS): {e}")
        
        # 2. Wait for content to hydrate with polling
        max_attempts = 6
        explore_links = []
        
        for attempt in range(max_attempts):
            delay = random.uniform(1500, 2500) if attempt == 0 else 2000
            # If the context gets destroyed, we shouldn't fail completely. We log and keep polling.
            try:
                await page.wait_for_timeout(delay)
                
                # Scroll down to trigger lazy loading of more cards
                await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                await page.wait_for_timeout(1000)
                
                # Use JavaScript to extract all resolved hrefs
                all_links = await page.evaluate('''() => {
                    return Array.from(document.querySelectorAll("a"))
                        .map(a => a.href)
                        .filter(href => href && href.includes("/explore/") && !href.endsWith("/explore/"));
                }''')
                
                # Filter to valid post URLs - KEEP full URL with xsec_token params
                explore_links = []
                seen_ids = set()
                for link in all_links:
                    match = re.search(r'/explore/([a-zA-Z0-9]{10,})', link)
                    if match:
                        note_id = match.group(1)
                        if note_id not in seen_ids:
                            seen_ids.add(note_id)
                            # Keep the FULL URL including xsec_token params
                            explore_links.append(link)
                        if len(explore_links) >= 20:  # Increased from 5 to 20
                            break
                
                if len(explore_links) >= 20 or attempt >= max_attempts - 1:
                    logger.info(f"Found {len(explore_links)} explore links on attempt {attempt + 1}")
                    break
                
                logger.info(f"Attempt {attempt + 1}/{max_attempts}: Found {len(explore_links)} links, waiting for more...")
                
            except Exception as e:
                err_str = str(e)
                if "Execution context was destroyed" in err_str or "Target page, context or browser has been closed" in err_str:
                    logger.warning(f"Attempt {attempt + 1}/{max_attempts}: Page navigation interrupted script (Context Destroyed). Retrying...")
                else:
                    logger.error(f"Attempt {attempt + 1}/{max_attempts}: Unexpected evaluate error: {err_str}")
        
        if not explore_links:
            logger.warning(f"No explore links found after {max_attempts} attempts for keyword: {keyword}")
            import time
            import os
            screenshot_path = f"/data/screenshots/xhs_search_fail_{int(time.time())}.png"
            if os.path.exists("/data/screenshots"):
                try:
                    await page.screenshot(path=screenshot_path)
                    logger.warning(f"DEBUG_ARTIFACTS: Saved failure screenshot to {screenshot_path}")
                except Exception as ex:
                    logger.error(f"Failed to capture screenshot: {ex}")
            return []
        
        logger.info(f"Extracted XHS post URLs: {[u.split('?')[0] for u in explore_links]}")
        return explore_links
