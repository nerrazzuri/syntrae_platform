import asyncio
import argparse
import logging
import os
from pathlib import Path
from integration.client import IntegrationClient
from main_automation import run_automation

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("Poller")
DEFAULT_LEASE_SECONDS = int(os.getenv("AUTOMATION_LEASE_SECONDS", "120"))
HEARTBEAT_INTERVAL_SECONDS = int(os.getenv("AUTOMATION_HEARTBEAT_SECONDS", "30"))
POLL_INTERVAL_SECONDS = int(os.getenv("AUTOMATION_POLL_SECONDS", "5"))
SWEEP_INTERVAL_SECONDS = int(os.getenv("AUTOMATION_SWEEP_SECONDS", "60"))
STALE_MINUTES = int(os.getenv("AUTOMATION_STALE_MINUTES", "10"))
STALE_RETRY_DELAY_SECONDS = int(os.getenv("AUTOMATION_STALE_RETRY_DELAY_SECONDS", "30"))
STALE_MAX_ATTEMPTS = int(os.getenv("AUTOMATION_STALE_MAX_ATTEMPTS", "3"))
STALE_SWEEP_LIMIT = int(os.getenv("AUTOMATION_STALE_SWEEP_LIMIT", "25"))
STORAGE_ROOT = Path(os.getenv("AUTOMATION_STORAGE_ROOT", "/data/storage"))

def normalize_session_platform(platform: str) -> str:
    normalized = (platform or "").strip().lower()
    if normalized in {"rednote", "xiaohongshu", "xhs"}:
        return "rednote"
    return normalized or platform

async def poll_loop(platform, brand_id, install_id):
    # ... (Keep existing logic if needed, or deprecate)
    pass 

def resolve_storage_state_path(workspace_id: str | None, brand_id: str, platform: str) -> str | None:
    normalized_platform = normalize_session_platform(platform)
    workspace_brand_session = STORAGE_ROOT / "sessions" / (workspace_id or "unknown-workspace") / brand_id / normalized_platform / "session.json"
    brand_session = STORAGE_ROOT / "sessions" / brand_id / normalized_platform / "session.json"
    legacy_session = STORAGE_ROOT / "session.json"

    if workspace_id and workspace_brand_session.exists():
        return str(workspace_brand_session)
    if brand_session.exists():
        return str(brand_session)
    if legacy_session.exists():
        logger.warning(
            "Using legacy shared session file. Migrate to %s for safe multi-workspace execution.",
            workspace_brand_session
        )
        return str(legacy_session)
    return None

async def heartbeat_loop(client: IntegrationClient, run_id: str, claim_token: str):
    while True:
        await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)
        renewed = await client.heartbeat_claimed_run(
            run_id=run_id,
            claim_token=claim_token,
            lease_seconds=DEFAULT_LEASE_SECONDS
        )
        if not renewed:
            logger.warning(f"Lease heartbeat failed for job {run_id}.")
            return

async def global_poll_loop(install_id):
    # Valid "Unbound" client for initial fetch
    client = IntegrationClient(brand_id="system", install_id=install_id)
    operator_url = client.operator_url
    logger.info(f"Global Worker {install_id} starting against {operator_url}...")
    last_sweep_at = 0.0

    while True:
        try:
            now = asyncio.get_event_loop().time()
            if now - last_sweep_at >= SWEEP_INTERVAL_SECONDS:
                sweep_result = await client.sweep_stale_runs(
                    stale_minutes=STALE_MINUTES,
                    retry_delay_seconds=STALE_RETRY_DELAY_SECONDS,
                    max_attempts=STALE_MAX_ATTEMPTS,
                    limit=STALE_SWEEP_LIMIT
                )
                last_sweep_at = now

                if sweep_result and (sweep_result.get("requeued") or sweep_result.get("failed")):
                    logger.info(
                        "Swept stale runs: requeued=%s failed=%s",
                        sweep_result.get("requeued", 0),
                        sweep_result.get("failed", 0)
                    )

            run_data = await client.claim_next_run(lease_seconds=DEFAULT_LEASE_SECONDS)
            if not run_data:
                await asyncio.sleep(POLL_INTERVAL_SECONDS)
                continue

            run_id = run_data.get("id")
            brand_id = run_data.get("brand_id")
            platform = run_data.get("platform")
            claim_token = run_data.get("claim_token")
            workspace_id = run_data.get("workspace_id")
            ingestion_install_id = run_data.get("ingestion_install_id")
            ingestion_install_secret = run_data.get("ingestion_install_secret")

            logger.info(f"🚀 Claimed Job {run_id} for Brand {brand_id}...")

            if not run_id or not brand_id or not platform or not claim_token:
                logger.error(f"Claim response incomplete: {run_data}")
                await asyncio.sleep(5)
                continue

            storage_path = resolve_storage_state_path(workspace_id, brand_id, platform)
            client.set_ingestion_install(ingestion_install_id, ingestion_install_secret)

            if storage_path:
                logger.info(f"Using Session File: {storage_path}")

            heartbeat_task = asyncio.create_task(heartbeat_loop(client, run_id, claim_token))

            try:
                success = await run_automation(
                    platform,
                    "chromium",
                    True,
                    None,
                    brand_id,
                    install_id,
                    storage_state_path=storage_path,
                    existing_run_id=run_id,
                    claim_token=claim_token,
                    ingestion_install_id=ingestion_install_id,
                    ingestion_install_secret=ingestion_install_secret,
                )

                if not success:
                    await client.update_run_internal(
                        run_id=run_id,
                        status="FAILED",
                        abort_reason="AUTOMATION_FAILED",
                        claim_token=claim_token
                    )
                    logger.info(f"Job {run_id} finished with status FAILED.")
                else:
                    logger.info(f"Job {run_id} finished via in-run lifecycle updates.")
            finally:
                heartbeat_task.cancel()
                try:
                    await heartbeat_task
                except asyncio.CancelledError:
                    pass
        except Exception as e:
            logger.error(f"Global Poll Error: {e}")
        
        await asyncio.sleep(POLL_INTERVAL_SECONDS)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--install-id", default="system-worker-1")
    parser.add_argument("--mode", default="single", choices=["single", "global"])
    parser.add_argument("--brand-id", help="Required for single mode")
    parser.add_argument("--platform", default="xiaohongshu")
    
    args = parser.parse_args()
    
    if args.mode == "global":
        asyncio.run(global_poll_loop(args.install_id))
    else:
        asyncio.run(poll_loop(args.platform, args.brand_id, args.install_id))
