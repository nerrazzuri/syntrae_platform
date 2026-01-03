import asyncio
import logging
import os
from video_detection_engine.browser.controller import BrowserController
from video_detection_engine.platforms.tiktok import TikTokAdapter
from video_detection_engine.behavior.search_navigator import TikTokSearchNavigator
from video_detection_engine.utils.validators import VideoPageValidator

# Configure Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("Verification")

async def test_real_extraction():
    # Ensure storage state exists (or warn)
    if not os.path.exists("storage_state.json"):
        logger.warning("storage_state.json not found! You might hit login walls. Run 'python main_automation.py login' first.")

    controller = BrowserController(headless=False, storage_state_path="storage_state.json") # Headful for verification visibility
    
    try:
        await controller.launch()
        await controller.new_context()
        
        # 1. Search
        term = "digital nomad gadgets" # Niche enough to have real comments but not too generic
        search_url = f"https://www.tiktok.com/search?q={term.replace(' ', '%20')}"
        
        logger.info(f"Navigating to Search: {search_url}")
        
        nav = TikTokSearchNavigator(controller.page)
        candidates = await nav.search_and_extract(search_url, max_results=3)
        
        if not candidates:
            logger.error("FAIL: No candidates found via search.")
            return
            
        logger.info(f"Found {len(candidates)} candidates. Selecting first valid...")
        
        target_cand = candidates[0]
        logger.info(f"Selected Candidate: {target_cand.video_url}")
        
        # 2. Extract
        logger.info("Navigating to Video Page...")
        await controller.navigate(target_cand.video_url)
        
        valid, reason = await VideoPageValidator.validate(controller.page)
        if not valid:
            logger.error(f"FAIL: Video page invalid: {reason}")
            # Try next?
            if len(candidates) > 1:
                target_cand = candidates[1]
                logger.info(f"Retrying with second candidate: {target_cand.video_url}")
                await controller.navigate(target_cand.video_url)
                valid, reason = await VideoPageValidator.validate(controller.page)
                if not valid:
                    logger.error(f"FAIL: Second candidate also invalid: {reason}")
                    return
            else:
                return
        
        logger.info("Video Page Validated. Extracting Comments...")
        adapter = TikTokAdapter(controller.page)
        comments = await adapter.extract_comments()
        
        if not comments:
            logger.error("FAIL: Zero comments found.")
            return

        first_comment = comments[0]['content_text']
        if first_comment == "Sample captured comment":
             logger.error("FAIL: Mock content detected! Mock removal failed.")
             return
             
        logger.info(f"SUCCESS: Extracted {len(comments)} real comments.")
        logger.info(f"Sample: {first_comment[:50]}...")
        
    except Exception as e:
        logger.error(f"Verification Failed: {e}")
    finally:
        await controller.close()

if __name__ == "__main__":
    asyncio.run(test_real_extraction())
