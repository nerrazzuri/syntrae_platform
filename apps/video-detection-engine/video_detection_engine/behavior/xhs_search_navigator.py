import logging
import random
import urllib.parse
from typing import List

logger = logging.getLogger(__name__)

class XHSSearchNavigator:
    @staticmethod
    async def search(page, keyword: str) -> List[str]:
        """
        Navigates to Xiaohongshu search results and extracts up to 5 post URLs.
        """
        encoded_keyword = urllib.parse.quote(keyword)
        search_url = f"https://www.xiaohongshu.com/search_result?keyword={encoded_keyword}"
        
        logger.info(f"Navigating to search URL: {search_url}")
        
        # 1. Navigate to page
        await page.goto(search_url, wait_until="domcontentloaded")
        
        # 2. Wait for content to hydrate
        try:
            await page.wait_for_selector("a[href*='/explore/']", timeout=10000)
            
            # Small random delay for safety
            delay = random.uniform(1500, 3000)
            await page.wait_for_timeout(delay)
            
        except Exception as e:
            logger.warning(f"Search results failed to load within timeout: {e}")
            return []
            
        # 3. Extract URLs
        try:
            # We specifically target explore links, getting up to 5 Phase-1 limit
            elements = await page.query_selector_all("a[href*='/explore/']")
            urls = []
            
            for el in elements:
                href = await el.get_attribute("href")
                if href and "/explore/" in href:
                    if "?" in href:
                        continue
                        
                    # ensure absolute url if relative
                    if href.startswith("/"):
                        full_url = f"https://www.xiaohongshu.com{href}"
                    else:
                        full_url = href
                        
                    if full_url not in urls:
                        urls.append(full_url)
                        
                    if len(urls) >= 5:
                        break
                        
            return urls
            
        except Exception as e:
            logger.error(f"Failed to extract URLs from search results: {e}")
            return []
