import asyncio
import argparse
import logging
import time
from integration.client import IntegrationClient
from main_automation import run_automation

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("Poller")

async def poll_loop(platform, brand_id, install_id):
    # ... (Keep existing logic if needed, or deprecate)
    pass 

async def global_poll_loop(install_id):
    # Valid "Unbound" client for initial fetch
    client = IntegrationClient(brand_id="system", install_id=install_id)
    operator_url = client.operator_url # Access the property
    logger.info(f"Global Worker {install_id} starting against {operator_url}...")

    import httpx

    while True:
        try:
            # 1. Check Global Pending
            # Internal call: No /api prefix (Express app is root)
            url = f"{operator_url}/runs/pending"
            headers = {"x-install-id": install_id}
            
            async with httpx.AsyncClient() as http:
                resp = await http.get(url, headers=headers)
                
                if resp.status_code == 200 and resp.text.strip() and resp.text != "null":
                    run_data = resp.json()
                    run_id = run_data.get("id")
                    brand_id = run_data.get("brand_id")
                    platform = run_data.get("platform")
                    
                    logger.info(f"🚀 Claiming Job {run_id} for Brand {brand_id}...")
                    
                    # Update Status to RUNNING
                    await http.put(f"{operator_url}/brands/{brand_id}/automation-runs/{run_id}", 
                        json={"status": "RUNNING"}, headers=headers)
                    
                    # Execute
                    import os
                    session_path = "/data/storage/session.json"
                    storage_path = session_path if os.path.exists(session_path) else None
                    
                    if storage_path:
                        logger.info(f"Using Session File: {storage_path}")

                    await run_automation(platform, "chromium", True, storage_path, brand_id, install_id)
                    
                    # Complete
                    await http.put(f"{operator_url}/brands/{brand_id}/automation-runs/{run_id}", 
                        json={"status": "COMPLETED"}, headers=headers)
                    
                    logger.info("Job Done.")
                
                logger.info("Job Done.")
            
        except Exception as e:
            logger.error(f"Global Poll Error: {e}")
        
        await asyncio.sleep(5)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--install-id", default="system-worker-1")
    parser.add_argument("--mode", default="single", choices=["single", "global"])
    parser.add_argument("--brand-id", help="Required for single mode")
    parser.add_argument("--platform", default="tiktok")
    
    args = parser.parse_args()
    
    if args.mode == "global":
        asyncio.run(global_poll_loop(args.install_id))
    else:
        asyncio.run(poll_loop(args.platform, args.brand_id, args.install_id))
