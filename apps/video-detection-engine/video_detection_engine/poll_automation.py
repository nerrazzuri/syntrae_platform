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
    logger.info(f"Global Worker {install_id} starting...")

    while True:
        try:
            # 1. Check Global Pending
            url = f"{client.base_url}/runs/pending"
            headers = {"x-install-id": install_id}
            
            resp = client.client.get(url, headers=headers)
            
            if resp.status_code == 200 and resp.text.strip() and resp.text != "null":
                run_data = resp.json()
                run_id = run_data.get("id")
                brand_id = run_data.get("brand_id")
                platform = run_data.get("platform")
                
                logger.info(f"🚀 Claiming Job {run_id} for Brand {brand_id}...")
                
                # Update Status to RUNNING
                # We need a client bound to this brand (legacy design) or just use raw URL
                client.client.put(f"{client.base_url}/brands/{brand_id}/automation-runs/{run_id}", 
                    json={"status": "RUNNING"}, headers=headers)
                
                # Execute
                await run_automation(platform, "chromium", True, None, brand_id, install_id)
                
                # Complete
                client.client.put(f"{client.base_url}/brands/{brand_id}/automation-runs/{run_id}", 
                    json={"status": "COMPLETED"}, headers=headers)
                
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
