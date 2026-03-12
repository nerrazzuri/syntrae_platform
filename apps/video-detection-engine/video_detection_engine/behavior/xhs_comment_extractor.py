import logging
import random
from typing import List

logger = logging.getLogger(__name__)

class XHSCommentExtractor:
    @staticmethod
    async def extract(page) -> List[dict]:
        """
        Scrolls the page to trigger React comment hydration,
        waits for the comment container, and extracts top-level comments.
        """
        # 1. Scroll Routine
        for i in range(3):
            # Scroll down smoothly
            await page.mouse.wheel(delta_x=0, delta_y=2000)
            
            # Random delay
            delay = random.uniform(1500, 3000)
            await page.wait_for_timeout(delay)
            
        # 2. Wait for actual Comment Container hydration
        try:
            # First ensure the overall section exists
            await page.wait_for_selector("div[class*='comment']", timeout=5000)
        except Exception as e:
            logger.warning(f"Comment container never materialized: {e}")
            return []
            
        # 3. Extract Comments
        try:
            comments = []
            
            # Gather all comment items using broad element selection scoped properly
            comment_items = await page.query_selector_all("div[class*='comment']")
            
            # Usually parent elements contain child elements. 
            # Easiest way to target actual comment cards is finding elements inside them
            # We want to extract max 10 comments
            
            count: int = 0
            for item in comment_items:
                if not await item.is_visible():
                    continue
                    
                if count >= 10:
                    break
                    
                # Scoped selectors
                username_el = await item.query_selector("span")
                text_el = await item.query_selector("p")
                
                # We need both username and text to consider it a legitimate comment
                if username_el and text_el:
                    username = await username_el.inner_text()
                    comment_text = await text_el.inner_text()
                    
                    # Basic sanity check to avoid grabbing raw nested HTML junk
                    username = username.strip()
                    comment_text = comment_text.strip()
                    
                    if username and comment_text:
                        comments.append({
                            "username": username,
                            "comment_text": comment_text
                        })
                        count += 1
                        
            return comments
            
        except Exception as e:
            logger.error(f"Failed extracting comments: {e}")
            return []
