import logging
import asyncio
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
    RESULT_ITEM = 'div[data-e2e="search_top-item"]' # Top Results often mixed. 
    # Better: 'div[data-e2e="search_video-item"]' # Specifically videos
    RESULT_VIDEO_ITEM = 'div[data-e2e="search_video-item"]'
    
    def __init__(self, page: Page):
        self.page = page

    async def search_and_extract(self, search_url: str, max_results: int = 5) -> List[VideoCandidate]:
        logger.info(f"Navigating to Search: {search_url}")
        
        try:
            await self.page.goto(search_url, wait_until="domcontentloaded", timeout=45000)
            
            # Check for "No results" or Login Wall
            # Login wall might appear. Session persistence should handle it.
            
            # Strategy: Check if we are in "You may like" landing (Mobile/soft-fail)
            # If so, try to find search input and type explicitly.
            
            # Detect Search Box (Mobile/Desktop)
            search_input = self.page.locator('input[type="search"], input[placeholder="Search"]')
            
            try:
                # 1. Primary Wait (Standard)
                await self.page.wait_for_selector(self.RESULT_VIDEO_ITEM, timeout=5000)
            except Exception:
                # 2. Fallback: Explicit Mobile Interaction
                fallback_success = False
                try:
                    if await search_input.count() > 0:
                        logger.info("Results not found. Attempting explicit search interaction (Mobile/Fallback)...")
                        
                        from urllib.parse import urlparse, parse_qs
                        parsed = urlparse(search_url)
                        query_params = parse_qs(parsed.query)
                        query = query_params.get('q', [''])[0]
                        
                        if query:
                            logger.info(f"Typing query: {query}")
                            await search_input.fill(query)
                            await self.page.keyboard.press("Enter")
                            
                            try:
                                # 1. Try "Search" button (Red text usually)
                                search_btns = self.page.locator('div[role="button"]:has-text("Search"), button:has-text("Search"), span:has-text("Search")')
                                count = await search_btns.count()
                                if count > 0:
                                    logger.info(f"Found {count} 'Search' buttons. Clicking visible ones...")
                                    for i in range(count):
                                        btn = search_btns.nth(i)
                                        if await btn.is_visible():
                                            await btn.click(timeout=1000)
                                            logger.info(f"Clicked 'Search' button candidate {i}")
                                            # We don't break immediately, just in case. 
                                            # Actually, if it navigates, the next click might fail, which is fine.

                                # 2. Fallback: Click the suggestion that matches the query
                                await self.page.wait_for_timeout(500)
                                
                                # Targeted "Click Suggestion"
                                # We find all elements with the query text, skip the Input field, and click the others.
                                query_matches = self.page.locator(f'text="{query}"')
                                q_count = await query_matches.count()
                                
                                for i in range(q_count):
                                    el = query_matches.nth(i)
                                    if await el.is_visible():
                                        tag = await el.evaluate("el => el.tagName")
                                        if tag == "INPUT":
                                            continue # Don't click the input again
                                        
                                        logger.info(f"Clicking suggestion candidate {i} ({tag})...")
                                        try:
                                            await el.click(timeout=1000)
                                        except:
                                            pass
                                
                            except Exception as e:
                                logger.warning(f"Mobile interaction tweaks failed: {e}")
                            
                            # Wait for results AGAIN.
                            
                            # Wait for results AGAIN. We use a broader selector for mobile.
                            try:
                                await self.page.wait_for_selector(self.RESULT_VIDEO_ITEM, timeout=15000)
                                fallback_success = True
                            except:
                                # Try alternative selector if primary fails
                                logger.warning("Mobile: Primary selector failed, trying alternatives...")
                                try:
                                    await self.page.wait_for_selector('div[data-e2e="search_top-item"], div[class*="DivItemContainer"]', timeout=5000)
                                    fallback_success = True
                                    # If this works, we need to adapt candidate extraction below to support these selectors?
                                    # For now, just confirming presence prevents the Error.
                                except:
                                    raise # Fail to trigger dump
                        else:
                            raise 
                    else:
                        raise # No input found either
                except Exception as inner_e:
                    logger.warning(f"Fallback search failed: {inner_e}")
                    # Did NOT succeed. Propagate to Debug Dump logic.
                    pass # Continue to outer exception handling (Debug Dump is inside the 'except' block? No, it's next)

                if not fallback_success:
                     # Proceed to debug dump
                     pass 
                     
                if not fallback_success:
                     # === DEBUG PROOF ARTIFACTS ===
                    try:
                        import time
                        ts = int(time.time())
                        safe_name = f"search_fail_{ts}"
                        screenshot_path = f"/tmp/tiktok_{safe_name}.png"
                        html_path = f"/tmp/tiktok_{safe_name}.html"
                        await self.page.screenshot(path=screenshot_path, full_page=True)
                        html = await self.page.content()
                        with open(html_path, "w", encoding="utf-8") as f:
                            f.write(html)
                        logger.warning("SEARCH DEBUG | title=%s url=%s screenshot=%s html=%s", await self.page.title(), self.page.url, screenshot_path, html_path)
                    except Exception as e:
                        logger.error("SEARCH DEBUG failed: %s", e)
                    
                    logger.warning(f"No search results found for {search_url} (or blocked).")
                    return []
            
            # Continue to extraction
            # If fallback succeeded, we are here.
                # Legacy/Dead code block removed
                pass

                logger.warning(f"No search results found for {search_url} (or blocked).")
                return []

            candidates = []
            items = self.page.locator(self.RESULT_VIDEO_ITEM)
            count = await items.count()
            logger.info(f"Found {count} raw result items.")
            
            # Iterate
            for i in range(count):
                if len(candidates) >= max_results:
                    break
                
                item = items.nth(i)
                
                # Check for Ad? (Usually have different structure, or 'Ad' badge)
                # We filter by URL validity primarily.
                
                try:
                    # Link
                    # Often the entire container or a specific 'a' tag
                    link_locator = item.locator('a[href*="/video/"]').first
                    if await link_locator.count() == 0:
                        continue
                        
                    raw_url = await link_locator.get_attribute("href")
                    if not raw_url:
                        continue
                        
                    clean_url = VideoURLNormalizer.normalize(raw_url)
                    video_id = VideoURLNormalizer.extract_id(clean_url)
                    
                    if not clean_url or not video_id:
                        continue
                        
                    # Extract Metadata (Best Effort)
                    caption = ""
                    # Trying common selectors for description
                    # search-card-desc is common
                    desc_loc = item.locator('[data-e2e="search-card-desc"]') 
                    if await desc_loc.count() > 0:
                        caption = await desc_loc.inner_text()
                    else:
                        # Fallback to image alt?
                        img = item.locator('img').first
                        caption = await img.get_attribute("alt") or ""

                    # Author
                    handle = ""
                    user_loc = item.locator('[data-e2e="search-card-user-unique-id"]')
                    if await user_loc.count() > 0:
                        handle = await user_loc.inner_text()

                    cand = VideoCandidate(
                        video_url=clean_url,
                        video_id=video_id,
                        caption=caption[:500], # Truncate check
                        hashtags=[], # Extract from caption if needed
                        author_handle=handle,
                        platform="tiktok"
                    )
                    candidates.append(cand)
                    
                except Exception as e:
                    logger.debug(f"Failed to extract candidate {i}: {e}")
                    continue
            
            return candidates

        except Exception as e:
            logger.error(f"Search navigation failed: {e}")
            return []
