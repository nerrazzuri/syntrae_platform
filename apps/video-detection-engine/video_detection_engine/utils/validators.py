import re
import logging
from typing import Optional, Tuple
from playwright.async_api import Page

logger = logging.getLogger(__name__)

class VideoURLNormalizer:
    """
    Canonicalizes TikTok Video URLs.
    Pattern: https://www.tiktok.com/@user/video/1234567890
    """
    
    @staticmethod
    def normalize(url: str) -> Optional[str]:
        if not url:
            return None
            
        # Regex to capture ID
        # Supports:
        # - https://www.tiktok.com/@user/video/123
        # - https://m.tiktok.com/v/123.html
        # - https://vm.tiktok.com/ZGe...
        
        # Simple extraction of video ID from standard web URL
        match = re.search(r'/video/(\d+)', url)
        if match:
            video_id = match.group(1)
            # We don't preserve user handle in canonical form if we want pure ID stability, 
            # but standard URL includes it.
            # Best effort to keep handle if present, else use generic.
            
            handle_match = re.search(r'(@[\w\.]+)', url)
            handle = handle_match.group(1) if handle_match else "@tiktok_user"
            
            return f"https://www.tiktok.com/{handle}/video/{video_id}"
            
        return None

    @staticmethod
    def extract_id(url: str) -> Optional[str]:
        match = re.search(r'/video/(\d+)', url)
        return match.group(1) if match else None


class VideoPageValidator:
    """
    Validates if the current page is a playable TikTok video with Comments.
    """
    
    REQUIRED_SELECTORS = [
        "div[data-e2e='comment-list']", # CRITICAL: Comments must be present
        "video" # CRITICAL: Video player
    ]
    
    FORBIDDEN_TITLES = ["Explore", "Search", "TikTok - Make Your Day"]

    @classmethod
    async def validate(cls, page: Page) -> Tuple[bool, Optional[str]]:
        """
        Returns (is_valid, failure_reason)
        """
        try:
            # 1. URL Check
            url = page.url
            if "/video/" not in url:
                return False, "URL_MISMATCH"
            
            # 2. Title Check (Fast Fail)
            title = await page.title()
            for forbidden in cls.FORBIDDEN_TITLES:
                if forbidden in title and "video" not in title.lower():
                     # Edge case: Title might be "Search | TikTok"
                     if "Search" in title:
                         return False, "PAGE_IS_SEARCH"
                     pass 

            # 3. DOM Check (Strict)
            # FORCE SCROLL to trigger lazy comments
            await page.mouse.wheel(0, 1200)
            await page.wait_for_timeout(1500)
            
            # Check Comment Container specifically (Tolerant Wait)
            try:
                await page.wait_for_selector(
                    "div[data-e2e='comment-list'], div[data-e2e='comment-container']",
                    timeout=8000
                )
            except Exception:
                return False, "COMMENT_CONTAINER_MISSING"

            # Check Video Player
            if await page.locator("video").count() == 0:
                return False, "VIDEO_PLAYER_MISSING"
                
            return True, None
            
        except Exception as e:
            logger.error(f"Validation error: {e}")
            return False, f"VALIDATION_ERROR: {str(e)}"
