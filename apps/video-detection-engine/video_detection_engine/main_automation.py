
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

from behavior.enforcer import PolicyEnforcer

async def run_automation(platform: str, browser_type: str, headless: bool, url: str, brand_id: str, install_id: str):
    """
    Main automation loop with Relevance & Integration wiring + POLICY ENFORCEMENT.
    """
    # 1. Initialize Integration Client
    client = IntegrationClient(brand_id=brand_id, install_id=install_id)
    logger.info(f"Initialized Automation for Brand {brand_id} (Agent: {install_id})")

    # 2. Fetch Policy
    policy_data = await client.get_policy(brand_id)
    if policy_data is None: 
        logger.error("Could not fetch policy. Aborting for safety.")
        return

    enforcer = PolicyEnforcer(policy_data)
    
    # 3. Policy Gate: Start Run
    if not enforcer.check_run_gate():
        return
        
    # 4. Create Run Record (Snapshot Persistence)
    run_id = await client.create_run(
        policy_id=policy_data.get("id"),
        policy_snapshot=policy_data,
        platform=platform
    )
    if not run_id:
        logger.warning("Could not create run record. Proceeding (or should we abort for strict audit?). Proceeding for now.")

    controller = BrowserController(browser_type=browser_type, headless=headless)
    
    try:
        # 5. Launch Browser
        await controller.launch()
        await controller.new_context()
        
        # 6. Select Adapter
        if platform.lower() == "tiktok":
            adapter = TikTokAdapter(controller.page)
        else:
            raise ValueError(f"Unsupported platform: {platform}")
            
        # 6. Execute Extraction
        target_url = url or "https://www.tiktok.com/"
        
        # Pacing: Navigating
        await enforcer.pace_action("navigation")
        
        # Loop simulation (Single Item for POC)
        # Note: In real scenarios, this is a loop over videos.
        # We simulate checking video limit here.
        if not enforcer.check_video_limit_gate():
            return
            
        comments = await adapter.extract_comments(target_url)
        enforcer.track_video()
        
        # Pacing: Post-Extraction
        await enforcer.pace_action("extraction")
        
        video_comments_processed = 0
        
        for comment in comments:
            # Policy Gate: Comments per Video
            if not enforcer.check_comment_limit_gate(video_comments_processed):
                break
                
            # 7. MARKET MATCH / RELEVANCE LOOP
            text_to_score = comment.get("content_text", "")
            hashtags = comment.get("hashtags", []) # Adapter needs to provide this
            
            logger.info(f"Checking market fit for: {text_to_score[:50]}...")
            await enforcer.pace_action("relevance_check")
            
            # Use new Market Match Service
            decision = await client.score_content(
                text=text_to_score,
                hashtags=hashtags,
                platform=platform
            )
            
            if decision.get("is_match"):
                score = decision.get("score", 0.0)
                logger.info(f"✅ MATCH ({score:.2f}): {decision.get('reasons')}")
                
                # 8. EMIT EVENT
                enriched_payload = comment.copy()
                enriched_payload.update({
                    "market_score": score,
                    "market_reasons": decision.get("reasons"),
                    "matched_keywords": decision.get("matched_keywords"),
                    "matched_hashtags": decision.get("matched_hashtags")
                })
                
                await client.emit_event("DESKTOP_CAPTURE", enriched_payload)
                enforcer.track_comment()
                video_comments_processed += 1
            else:
                score = decision.get("score", 0.0)
                logger.info(f"❌ IGNORED ({score:.2f}): {decision.get('reasons')}")
            
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
