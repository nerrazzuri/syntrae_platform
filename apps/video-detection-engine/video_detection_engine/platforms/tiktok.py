import logging
import asyncio
from typing import List, Dict, Any
from playwright.async_api import Page, Locator

logger = logging.getLogger(__name__)

class CommentExtractionError(Exception):
    """Raised when comment extraction fails to meet criteria."""
    pass

class TikTokAdapter:
    """
    Adapter for extracting comments from TikTok.
    Enforces Strict DOM Extraction (No Mocks).
    """
    
    # Selectors (Desktop Web)
    # Selectors (Desktop Web)
    COMMENT_CONTAINER = 'div[data-e2e="comment-list"], div[data-e2e="comment-container"]'
    COMMENT_ITEM = 'div[data-e2e="comment-level-1"]'
    COMMENT_TEXT = 'p[data-e2e="comment-level-1-content"]'
    COMMENT_USER = 'a[href*="/@"]' # User link usually contains /@
    
    def __init__(self, page: Page):
        self.page = page

    async def extract_comments(self, video_url: str = None, max_comments: int = 20) -> List[Dict[str, Any]]:
        """
        Extracts comments from the current page (or navigates if url provided).
        MUST raise CommentExtractionError if 0 valid comments found.
        """
        if video_url:
            logger.info(f"Navigating to video: {video_url}")
            await self.page.goto(video_url, wait_until="domcontentloaded", timeout=45000)
        
        # 1. Verify Container (Redundant check if Validator used, but good safety)
        try:
            container = self.page.locator(self.COMMENT_CONTAINER)
            await container.first.wait_for(state="visible", timeout=15000)
            
            # FORCE SCROLL to trigger lazy comments (Hydration)
            await self.page.mouse.wheel(0, 1200)
            await asyncio.sleep(1.5)
            
        except Exception:
            # If explicit URL navigation was requested, this is fatal. 
            # If not, caller might have validated, but we still need it for extraction.
            title = await self.page.title()
            raise CommentExtractionError(f"Comment container not found. Page: {title}")

        # 2. Scroll & Expand
        # Iterate scrolling the comment list until we have enough
        extrapolated_comments = []
        retries = 3
        
        while len(extrapolated_comments) < max_comments and retries > 0:
            # Locate current items
            items = container.locator(self.COMMENT_ITEM)
            count = await items.count()
            
            if count > len(extrapolated_comments):
                # We found new ones, reset retries
                retries = 3
                
                # Parse new items
                for i in range(len(extrapolated_comments), count):
                    if len(extrapolated_comments) >= max_comments:
                        break
                        
                    item = items.nth(i)
                    try:
                        text_el = item.locator(self.COMMENT_TEXT)
                        if await text_el.count() == 0:
                            continue
                            
                        text = await text_el.inner_text()
                        
                        # Author
                        author = "unknown"
                        # User handle is usually in the first link
                        user_el = item.locator('a[href*="/@"]').first
                        if await user_el.count() > 0:
                            href = await user_el.get_attribute("href")
                            if href and "/@" in href:
                                author = href.split("/@")[1].split("?")[0]
                        
                        # Timestamp/Likes - Optional for MVP, but good to have
                        
                        comment_data = {
                            "platform": "tiktok",
                            "video_url": self.page.url, 
                            "content_text": text,
                            "author": author,
                            "referral_comment_id": f"scraped_{i}" # No stable ID in DOM easily without ID attribute
                        }
                        
                        extrapolated_comments.append(comment_data)
                        
                    except Exception as e:
                        logger.warning(f"Failed to parse comment {i}: {e}")
                        continue
            else:
                retries -= 1
                
            # Scroll down
            await self.page.keyboard.press("End")
            await asyncio.sleep(2) # Wait for network
            
            # Additional safety: Js scroll
            # await self.page.evaluate("window.scrollTo(0, document.body.scrollHeight)")

        # 3. Final Validation (Contracts)
        if len(extrapolated_comments) == 0:
            raise CommentExtractionError("0 comments extracted from DOM.")
            
        logger.info(f"Successfully extracted {len(extrapolated_comments)} comments.")
        return extrapolated_comments
