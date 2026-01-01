import asyncio
import argparse
import logging
import time
from integration.client import IntegrationClient
from main_automation import run_automation

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("Poller")

async def poll_loop(platform, brand_id, install_id):
    client = IntegrationClient(brand_id=brand_id, install_id=install_id)
    
    logger.info(f"Agent {install_id} starting poll for Brand {brand_id}...")
    
    while True:
        try:
            # 1. Check for Pending Runs
            # We add a method to client for this
            # Or raw fetch if client updates take too long
            # Let's add functionality to client first ideally, but raw http for speed here:
            url = f"{client.base_url}/brands/{brand_id}/runs/pending"
            headers = {
                "x-install-id": install_id,
                "Content-Type": "application/json"
            }
            
            resp = client.client.get(url, headers=headers)
            
            if resp.status_code == 200 and resp.text.strip() and resp.text != "null":
                run_data = resp.json()
                run_id = run_data.get("id")
                logger.info(f"🚀 Found Pending Run {run_id}! Execute...")
                
                # 2. Execute
                # We reuse the logic from main_automation, but we might want to update the Run Status.
                # main_automation creates a NEW run record currently.
                # We should update main_automation to accept an existing run_id potentially?
                # Or just let it broadcast events and we mark the pending run as COMPLETED.
                
                # Update to RUNNING
                client.client.put(f"{client.base_url}/brands/{brand_id}/automation-runs/{run_id}", 
                    json={"status": "RUNNING"}, headers=headers)
                    
                await run_automation(platform, "chromium", True, None, brand_id, install_id)
                
                # Update to COMPLETED
                client.client.put(f"{client.base_url}/brands/{brand_id}/automation-runs/{run_id}", 
                    json={"status": "COMPLETED"}, headers=headers)
                    
                logger.info("Run Finished. Returning to poll...")
            
            else:
                pass
                # logger.debug("No jobs...")
                
        except Exception as e:
            logger.error(f"Poll Error: {e}")
            
        await asyncio.sleep(5)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--brand-id", required=True)
    parser.add_argument("--install-id", required=True)
    parser.add_argument("--platform", default="tiktok")
    args = parser.parse_args()
    
    asyncio.run(poll_loop(args.platform, args.brand_id, args.install_id))
