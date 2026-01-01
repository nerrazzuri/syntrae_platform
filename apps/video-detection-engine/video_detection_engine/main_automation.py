
import asyncio
import argparse
import logging
import json
import os
import nest_asyncio
from browser.controller import BrowserController
from platforms.tiktok import TikTokAdapter
from integration.client import IntegrationClient

# Patch asyncio for Jupyter/Re-entrant contexts if needed
nest_asyncio.apply()

# Configure Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("AutomationCLI")

async def run_automation(platform: str, browser_type: str, headless: bool, url: str, brand_id: str, install_id: str):
    """
    Main automation loop with Relevance & Integration wiring.
    """
    # 1. Initialize Integration Client
    client = IntegrationClient(brand_id=brand_id, install_id=install_id)
    logger.info(f"Initialized Automation for Brand {brand_id} (Agent: {install_id})")

    controller = BrowserController(browser_type=browser_type, headless=headless)
    
    try:
        # 2. Launch Browser
        await controller.launch()
        await controller.new_context()
        
        # 3. Select Adapter
        if platform.lower() == "tiktok":
            adapter = TikTokAdapter(controller.page)
        else:
            raise ValueError(f"Unsupported platform: {platform}")
            
        # 4. Execute Extraction
        target_url = url or "https://www.tiktok.com/"
        
        # Loop simulation (Single Item for POC)
        comments = await adapter.extract_comments(target_url)
        
        for comment in comments:
            # 5. RELEVANCE LOOP
            # Construct text for scoring: Comment + Video Metadata (if we had it)
            # For POC, using comment text.
            text_to_score = comment.get("content_text", "")
            
            logger.info(f"Checking relevance for: {text_to_score[:50]}...")
            decision = await client.check_relevance(
                text=text_to_score,
                platform=platform,
                metadata={}
            )
            
            if decision.get("relevant"):
                logger.info(f"✅ RELEVANT ({decision.get('confidence'):.2f}): {decision.get('reason')}")
                # 6. EMIT EVENT
                await client.emit_event("DESKTOP_CAPTURE", comment)
            else:
                logger.info(f"❌ IGNORED ({decision.get('confidence', 0):.2f}): {decision.get('reason')}")
                # Optional: Emit "REJECTED" event for analytics (Phase 37.2)
            
    except Exception as e:
        logger.error(f"Automation failed: {e}")
    finally:
        await controller.close()

def main():
    parser = argparse.ArgumentParser(description="External Browser Automation Engine")
    parser.add_argument("--platform", type=str, required=True, help="Target platform (tiktok, youtube, etc)")
    parser.add_argument("--browser", type=str, default="chromium", help="Browser engine (chromium, firefox, webkit)")
    parser.add_argument("--headless", action="store_true", help="Run in headless mode")
    parser.add_argument("--url", type=str, help="Specific URL to process")
    
    # New Arguments for Integration
    parser.add_argument("--brand-id", type=str, required=True, help="Target Brand ID for context")
    parser.add_argument("--install-id", type=str, required=True, help="Automation Agent Identity (Install ID)")
    
    args = parser.parse_args()
    
    # Load env vars for secrets? Or assume they are set in environment.
    # Docker entrypoint should handle env vars.
    
    asyncio.run(run_automation(
        args.platform, 
        args.browser, 
        args.headless, 
        args.url,
        args.brand_id,
        args.install_id
    ))

if __name__ == "__main__":
    main()
