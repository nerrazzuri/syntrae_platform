
import asyncio
import argparse
import logging
import json
import os
import nest_asyncio
from pathlib import Path
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

def resolve_session_output_path(output: str, platform: str, brand_id: str | None = None, workspace_id: str | None = None) -> str:
    if brand_id and output == "storage_state.json":
        base_dir = Path(os.getenv("STORAGE_ROOT", "/data/storage"))
        if workspace_id:
            target = base_dir / "sessions" / workspace_id / brand_id / platform / "session.json"
        else:
            target = base_dir / "sessions" / brand_id / platform / "session.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        return str(target)

    target = Path(output)
    if target.parent and str(target.parent) not in {"", "."}:
        target.parent.mkdir(parents=True, exist_ok=True)
    return str(target)

async def run_automation(
    platform: str,
    browser_type: str,
    headless: bool,
    url: str,
    brand_id: str,
    install_id: str,
    storage_state_path: str = None,
    existing_run_id: str | None = None,
    claim_token: str | None = None,
    workspace_plan_code: str | None = None,
    ingestion_install_id: str | None = None,
    ingestion_install_secret: str | None = None,
) -> bool:
    """
    Main automation loop with Relevance & Integration wiring + POLICY ENFORCEMENT.
    """
    # 1. Initialize Integration Client
    client = IntegrationClient(brand_id=brand_id, install_id=install_id)
    client.set_claim_context(claim_token)
    client.set_ingestion_install(ingestion_install_id, ingestion_install_secret)
    logger.info(f"Initialized Automation for Brand {brand_id} (Agent: {install_id})")

    # 2. Fetch Policy (WF-1: Internal Auth)
    logger.info("WF-1: Fetching Automation Policy (Internal)...")
    policy_data = await client.get_policy_internal()
    if not policy_data:
        logger.error("WF-1 FATAL: Could not fetch policy via internal endpoint. Aborting.")
        return False

    enforcer = PolicyEnforcer(policy_data)
    
    # 3. Policy Gate: Start Run
    if not enforcer.check_run_gate():
        return False
        
    # 4. Fetch Market Profile (WF-1: Internal Auth - Required for Snapshot)
    logger.info("WF-1: Fetching Market Profile (Internal)...")
    market_profile_data = await client.get_market_profile_internal()
    if not market_profile_data:
        logger.error("WF-1 FATAL: Could not fetch market profile via internal endpoint. Aborting.")
        return False

    # 5. Persist run snapshots on either a claimed queue row or a new internal run.
    if existing_run_id and claim_token:
        logger.info(f"WF-1: Starting claimed run {existing_run_id}...")
        started = await client.start_claimed_run_internal(
            run_id=existing_run_id,
            claim_token=claim_token,
            policy_snapshot=policy_data,
            market_profile_snapshot=market_profile_data,
            platform=platform,
            discovery_mode="FEED_SCROLL" if not url else "MANUAL_URL"
        )
        if not started:
            logger.error("WF-1 FATAL: Could not start claimed automation run. Aborting.")
            return False
        run_id = existing_run_id
    else:
        logger.info("WF-1: Creating Atomic Run...")
        run_id = await client.create_run_internal(
            policy_snapshot=policy_data,
            market_profile_snapshot=market_profile_data,
            platform=platform
        )
        if not run_id:
            logger.error("WF-1 FATAL: Could not create automation run. Aborting.")
            return False
    
    logger.info(f"WF-1: Run {run_id} Started Successfully.")

    normalized_platform = (platform or "").strip().lower()
    use_browser_runtime = normalized_platform not in {"rednote", "xiaohongshu", "xhs"}
    controller = BrowserController(
        browser_type=browser_type,
        headless=headless,
        storage_state_path=storage_state_path,
    ) if use_browser_runtime else None
    
    try:
        if controller:
            await controller.launch()
            await controller.new_context()
        
        # 6. Use the Profile WE JUST FETCHED (Consistent Snapshot)
        active_profile = market_profile_data 
        # Note: Empty profile means defaults or generic behavior if handled by Builder
        
        from video_detection_engine.core.discovery_engine import DiscoveryEngine
        engine = DiscoveryEngine(
            controller,
            client,
            run_id,
            brand_id,
            enforcer,
            platform=platform,
            xhs_session_path=storage_state_path,
            workspace_plan_code=workspace_plan_code,
        )

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

            # SEARCH is mandatory (Option B)
            try:
                await engine.execute(active_profile, finalize=False)
            except RuntimeError as e:
                # Treat as fatal search failure in URL mode
                try:
                    await client.update_run_internal(
                        run_id=run_id,
                        status="FAILED",
                        abort_reason="SEARCH_FATAL"
                    )
                except Exception as ue:
                    logger.error(f"Failed to update run status on SEARCH_FATAL: {ue}")
                return False
            
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

                error_class = decision.get("error_class")

                fatal_errors = {
                    "AI_CORE_HTTP_403",
                    "AI_CORE_HTTP_404",
                    "AI_CORE_HTTP_409",
                }

                status = "FAILED" if error_class in fatal_errors else "DEGRADED"
                try:
                    await client.update_run_internal(run_id=run_id, status=status, abort_reason=error_class)
                except Exception as e:
                    logger.error(f"Failed to update run status on ERROR: {e}")
                return False

            # WF-3.1: Obey decision strictly (no bypass)
            if decision["decision"] == "ACCEPT":
                engine.url_accepted = True
                engine.error_count = 0
                await engine._process_accepted_video(cand)

            # FINALIZE RUN (this is non-optional)
            await engine.finalize_run()
            return True
        else:
            # Search Mode (Discovery)
            if not active_profile:
                logger.error("No Market Profile found. Cannot perform Search Discovery.")
                return False

            # SEARCH is mandatory (Option B)
            await engine.execute(active_profile)

            # FINALIZE RUN (this is non-optional)
            await engine.finalize_run()
            return True
            
    except Exception as e:
        logger.error(f"Automation failed: {e}")
        return False
    finally:
        if controller:
            await controller.close()

async def run_manual_login(platform: str, browser_type: str, output: str, brand_id: str | None = None, workspace_id: str | None = None):
    """
    Launches a HEADFUL browser for manual login and saves the session state.
    """
    logger.info(f"Starting Manual Login for {platform}...")
    logger.info("Browser will launch. Please log in manually.")
    logger.info("When finished, return here and press ENTER to save session state.")
    output_path = resolve_session_output_path(output, platform, brand_id, workspace_id)
    logger.info(f"Session state will be saved to {output_path}")

    controller = BrowserController(browser_type=browser_type, headless=False) # Force Headful
    
    try:
        await controller.launch()
        login_targets = {
            "tiktok": "https://www.tiktok.com/login",
            "rednote": "https://www.xiaohongshu.com",
            "xiaohongshu": "https://www.xiaohongshu.com",
            "xhs": "https://www.xiaohongshu.com",
        }

        normalized_platform = platform.lower()
        url = login_targets.get(normalized_platform, "https://www.tiktok.com/")
        warmup_url = None if normalized_platform in {"rednote", "xiaohongshu", "xhs"} else "https://www.tiktok.com/foryou"

        await controller.new_context(warmup_url=warmup_url)
        await controller.navigate(url)
        
        # Block until user confirms
        await asyncio.get_event_loop().run_in_executor(None, input, "Press ENTER after you have successfully logged in...")
        
        await controller.save_storage_state(output_path)
        
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
    login_parser.add_argument("--brand-id", type=str, help="Optional brand id to store session under /data/storage/sessions/<brand>/<platform>/session.json")
    login_parser.add_argument("--workspace-id", type=str, help="Optional workspace id to store session under /data/storage/sessions/<workspace>/<brand>/<platform>/session.json")

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
        asyncio.run(run_manual_login(args.platform, args.browser, args.output, args.brand_id, args.workspace_id))

if __name__ == "__main__":
    main()
