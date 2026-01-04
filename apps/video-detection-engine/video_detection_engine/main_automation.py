
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

async def run_automation(platform: str, browser_type: str, headless: bool, url: str, brand_id: str, install_id: str, storage_state_path: str = None):
    """
    Main automation loop with Relevance & Integration wiring + POLICY ENFORCEMENT.
    """
    # 1. Initialize Integration Client
    client = IntegrationClient(brand_id=brand_id, install_id=install_id)
    logger.info(f"Initialized Automation for Brand {brand_id} (Agent: {install_id})")

    # 2. Fetch Policy (WF-1: Internal Auth)
    logger.info("WF-1: Fetching Automation Policy (Internal)...")
    policy_data = await client.get_policy_internal()
    if not policy_data:
        logger.error("WF-1 FATAL: Could not fetch policy via internal endpoint. Aborting.")
        return

    enforcer = PolicyEnforcer(policy_data)
    
    # 3. Policy Gate: Start Run
    if not enforcer.check_run_gate():
        return
        
    # 4. Fetch Market Profile (WF-1: Internal Auth - Required for Snapshot)
    logger.info("WF-1: Fetching Market Profile (Internal)...")
    market_profile_data = await client.get_market_profile_internal()
    if not market_profile_data:
        logger.error("WF-1 FATAL: Could not fetch market profile via internal endpoint. Aborting.")
        return

    # 5. Atomic Run Creation (Snapshot Persistence)
    logger.info("WF-1: Creating Atomic Run...")
    run_id = await client.create_run_internal(
        policy_snapshot=policy_data,
        market_profile_snapshot=market_profile_data,
        platform=platform
    )
    if not run_id:
        logger.error("WF-1 FATAL: Could not create automation run. Aborting.")
        return
    
    logger.info(f"WF-1: Run {run_id} Started Successfully.")

    controller = BrowserController(browser_type=browser_type, headless=headless, storage_state_path=storage_state_path)
    
    try:
        # 5. Launch Browser
        await controller.launch()
        await controller.new_context()
        
        # 6. Use the Profile WE JUST FETCHED (Consistent Snapshot)
        active_profile = market_profile_data 
        # Note: Empty profile means defaults or generic behavior if handled by Builder
        
        from video_detection_engine.core.discovery_engine import DiscoveryEngine
        engine = DiscoveryEngine(controller, client, run_id, enforcer)

        if url:
            # Single Video Mode (Manual Override)
            logger.info(f"Running in URL Mode: {url}")
            # Synthesize candidate
            from video_detection_engine.models import VideoCandidate
            from video_detection_engine.utils.validators import VideoURLNormalizer
            
            clean_url = VideoURLNormalizer.normalize(url) or url
            cand = VideoCandidate(
                video_url=clean_url, 
                video_id=VideoURLNormalizer.extract_id(clean_url) or "manual",
                platform=platform
            )
            
            # Direct processing bypasses search/score (or we can score it?)
            # Let's score it for consistency.
            decision = await engine._score_candidate(cand, active_profile)
            await client.record_discovery(run_id, decision)

            # WF-3.1: System failure must update run integrity
            if decision["decision"] == "ERROR":
                logger.error(
                    f"WF-3.1: System failure detected. "
                    f"error_class={decision.get('error_class')}"
                )

                # Mark run as DEGRADED (or FAILED if you prefer later)
                await client.update_run_internal(
                    run_id=run_id,
                    status="DEGRADED",
                    abort_reason=decision.get("error_class")
                )

                return
            
            # WF-3.1: Obey decision strictly (no bypass)
            if decision["decision"] == "ACCEPT":
                await engine._process_accepted_video(cand)
        else:
            # Search Mode (Discovery)
            if not active_profile:
                logger.error("No Market Profile found. Cannot perform Search Discovery.")
                return

            await engine.execute(active_profile)
            
    except Exception as e:
        logger.error(f"Automation failed: {e}")
    finally:
        await controller.close()

async def run_manual_login(platform: str, browser_type: str, output: str):
    """
    Launches a HEADFUL browser for manual login and saves the session state.
    """
    logger.info(f"Starting Manual Login for {platform}...")
    logger.info("Browser will launch. Please log in manually.")
    logger.info("When finished, return here and press ENTER to save session state.")

    controller = BrowserController(browser_type=browser_type, headless=False) # Force Headful
    
    try:
        await controller.launch()
        await controller.new_context()
        
        url = "https://www.tiktok.com/login" if platform == "tiktok" else "https://www.tiktok.com/"
        await controller.navigate(url)
        
        # Block until user confirms
        await asyncio.get_event_loop().run_in_executor(None, input, "Press ENTER after you have successfully logged in...")
        
        await controller.save_storage_state(output)
        
    except Exception as e:
        logger.error(f"Login failed: {e}")
    finally:
        await controller.close()

def main():
    parser = argparse.ArgumentParser(description="External Browser Automation Engine")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Subcommand: run (The automation)
    run_parser = subparsers.add_parser("run", help="Execute automation run")
    run_parser.add_argument("--platform", type=str, required=True, help="Target platform (tiktok, youtube, etc)")
    run_parser.add_argument("--browser", type=str, default="chromium", help="Browser engine")
    run_parser.add_argument("--headless", action="store_true", help="Run in headless mode")
    run_parser.add_argument("--url", type=str, help="Specific URL to process")
    run_parser.add_argument("--brand-id", type=str, required=True, help="Target Brand ID for context")
    run_parser.add_argument("--install-id", type=str, required=True, help="Automation Agent Identity (Install ID)")
    run_parser.add_argument("--storage-state", type=str, help="Path to storage state JSON", default="storage_state.json")

    # Subcommand: login (Manual Session Capture)
    login_parser = subparsers.add_parser("login", help="Manual login to capture session state")
    login_parser.add_argument("--platform", type=str, default="tiktok", help="Platform to log in to")
    login_parser.add_argument("--browser", type=str, default="chromium", help="Browser engine")
    login_parser.add_argument("--output", type=str, default="storage_state.json", help="Output path for session state")

    args = parser.parse_args()
    
    if args.command == "run":
        # Pass storage_state_path to run_automation (Need to update signature)
        # Assuming run_automation loads it via controller
        
        # Quick-fix: We need to pass storage_state to run_automation
        asyncio.run(run_automation(
            args.platform, 
            args.browser, 
            args.headless, 
            args.url,
            args.brand_id,
            args.install_id,
            args.storage_state
        ))
    elif args.command == "login":
        asyncio.run(run_manual_login(args.platform, args.browser, args.output))

if __name__ == "__main__":
    main()
