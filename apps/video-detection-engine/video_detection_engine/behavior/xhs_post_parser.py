import logging
import random

logger = logging.getLogger(__name__)

class XHSPostParser:
    @staticmethod
    async def parse(page, url: str) -> dict:
        """
        Navigates to the XHS post URL explicitly and parses the content.
        Uses stable selector timeouts.
        """
        logger.info(f"Opening post: {url}")
        
        # 1. Navigate
        await page.goto(url, wait_until="domcontentloaded")
        
        # 2. Wait for main content to hydrate
        try:
            await page.wait_for_selector("h1", timeout=10000)
            await page.wait_for_selector("div[class*='note']", timeout=10000)
            
            # Anti-bot jitter
            await page.wait_for_timeout(random.uniform(2000, 4000))
        except Exception as e:
            logger.error(f"Timeout waiting for post content hydration: {e}")
            return {
                "platform": "xiaohongshu",
                "post_url": url,
                "title": "",
                "author": "",
                "content_text": "",
                "like_count": None,
                "collect_count": None,
                "comment_count": None
            }

        # 3. Extract Fields
        try:
            # Title
            title_el = await page.query_selector("h1")
            title = await title_el.inner_text() if title_el else ""
            
            # Author
            author_el = await page.query_selector("a[href*='/user/profile']")
            author = await author_el.inner_text() if author_el else ""
            
            # Content Text
            content_el = await page.query_selector("div[class*='note']")
            content = await content_el.inner_text() if content_el else ""
            
            # Engagement Counters
            # Note: The raw HTML often separates likes, collects, comments using class hints 
            # We'll safely wrap these to gracefully fail if DOM shape changes slightly
            like_el = await page.query_selector("span[class*='like']")
            collect_el = await page.query_selector("span[class*='collect']")
            comment_metric_el = await page.query_selector("span[class*='comment']")
            
            def parse_metric(el_text) -> int | None:
                if not el_text: return None
                try:
                    # e.g "1.2k" or "10k" or "赞" or "1.2万"
                    import re
                    match = re.search(r'([\d.]+)([kw万]?)', str(el_text).lower())
                    if not match: return None
                    val = float(match.group(1))
                    mult = match.group(2)
                    if mult == 'k': val *= 1000
                    elif mult == 'w' or mult == '万': val *= 10000
                    return int(val)
                except:
                    return None

            like_count = parse_metric(await like_el.inner_text()) if like_el else None
            collect_count = parse_metric(await collect_el.inner_text()) if collect_el else None
            comment_count = parse_metric(await comment_metric_el.inner_text()) if comment_metric_el else None

            return {
                "platform": "xiaohongshu",
                "post_url": url,
                "title": title.strip(),
                "author": author.strip(),
                "content_text": content.strip(),
                "like_count": like_count,
                "collect_count": collect_count,
                "comment_count": comment_count
            }
        except Exception as e:
            logger.error(f"Error extracting metadata from {url}: {e}")
            return {
                "platform": "xiaohongshu",
                "post_url": url,
                "title": "",
                "author": "",
                "content_text": "",
                "like_count": None,
                "collect_count": None,
                "comment_count": None
            }
