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

import argparse
import sys

async def test_real_extraction(target_url: str = None):
    # Ensure storage state exists (or warn)
    if not os.path.exists("storage_state.json"):
        logger.warning("storage_state.json not found! You might hit login walls. Run 'python main_automation.py login' first.")

    controller = BrowserController(headless=False, storage_state_path="storage_state.json") # Headful for verification visibility
    
    try:
        await controller.launch()
        await controller.new_context()
        
        target_cand_url = target_url
        
        if not target_cand_url:
            # 1. Search (Fallback if no URL)
            term = "digital nomad gadgets" 
            search_url = f"https://www.tiktok.com/search?q={term.replace(' ', '%20')}"
            
            logger.info(f"Navigating to Search: {search_url}")
            
            nav = TikTokSearchNavigator(controller.page)
            candidates = await nav.search_and_extract(search_url, max_results=3)
            
            if not candidates:
                logger.error("FAIL: No candidates found via search.")
                print("VERIFICATION_FAILED")
                return
                
            target_cand_url = candidates[0].video_url
            logger.info(f"Selected Candidate: {target_cand_url}")
        
        # 2. Extract
        logger.info(f"Navigating to Video Page: {target_cand_url}")
        await controller.navigate(target_cand_url)
        
        # ASSERT: Page Opened
        if "tiktok.com" not in controller.page.url:
             logger.error("FAIL: Did not navigate to tiktok.com")
             print("VERIFICATION_FAILED")
             return

        valid, reason = await VideoPageValidator.validate(controller.page)
        if not valid:
            logger.error(f"FAIL: Video page invalid: {reason}")
            # If explicit URL failed, we stop.
            print("VERIFICATION_FAILED")
            return
        
        logger.info("Video Page Validated. Extracting Comments...")
        adapter = TikTokAdapter(controller.page)
        
        # Extract (Adapter handles scrolling)
        try:
            comments = await adapter.extract_comments(max_comments=10)
        except Exception as e:
            logger.error(f"FAIL: Extraction threw error: {e}")
            print("VERIFICATION_FAILED")
            return
        
        # ASSERT: Comments > 0
        if not comments:
            logger.error("FAIL: Zero comments found.")
            print("VERIFICATION_FAILED")
            return

        # ASSERT: Comment text non-empty
        first_comment = comments[0]['content_text']
        if not first_comment:
            logger.error("FAIL: First comment text is empty.")
            print("VERIFICATION_FAILED")
            return

        if first_comment == "Sample captured comment":
             logger.error("FAIL: Mock content detected! Mock removal failed.")
             print("VERIFICATION_FAILED")
             return
             
        logger.info(f"SUCCESS: Extracted {len(comments)} real comments.")
        logger.info(f"Sample: {first_comment[:50]}...")
        print("VERIFICATION_PASSED")
        
    except Exception as e:
        logger.error(f"Verification Failed: {e}")
        print("VERIFICATION_FAILED")
    finally:
        await controller.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", help="Direct TikTok Video URL to test")
    args = parser.parse_args()
    
    asyncio.run(test_real_extraction(args.url))
