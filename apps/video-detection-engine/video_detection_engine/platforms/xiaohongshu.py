import logging
import asyncio
import random

from video_detection_engine.behavior.xhs_search_navigator import XHSSearchNavigator
from video_detection_engine.behavior.xhs_post_parser import XHSPostParser
from video_detection_engine.behavior.xhs_comment_extractor import XHSCommentExtractor

logger = logging.getLogger(__name__)

class XiaohongshuPlatform:
    """
    Phase-1 Xiaohongshu Discovery Adapter.
    Validates end-to-end extraction capability.
    """
    async def run_search(self, browser_page, keyword):
        logger.info(f"Starting Xiaohongshu Discovery for keyword: {keyword}")
        
        search_page = browser_page
        post_page = await browser_page.context.new_page()
        
        try:
            urls = await XHSSearchNavigator.search(search_page, keyword)
            
            if not urls:
                logger.warning(f"No search results found for keyword: {keyword}")
                return []
                
            logger.info(f"Search results found: {len(urls)}")

            posts = []
            
            for index, url in enumerate(urls, start=1):
                logger.info(f"Processing post {index}/{len(urls)}")
                
                # Extract post metadata
                post = await XHSPostParser.parse(post_page, url)
                
                # Extract comments
                comments = await XHSCommentExtractor.extract(post_page)
                logger.info(f"Comments extracted: {len(comments)}")
                
                post["comments"] = comments
                posts.append(post)
                
                # Anti-bot pacing between posts
                if index < len(urls):
                    delay_ms = random.uniform(2000, 5000)
                    logger.debug(f"Pacing: waiting {delay_ms:.0f}ms before next post...")
                    await post_page.wait_for_timeout(delay_ms)

            return posts
            
        finally:
            await post_page.close()
