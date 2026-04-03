
import asyncio
import logging
import os
import argparse
from urllib.parse import quote
from playwright.async_api import async_playwright

# Setup simple logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("CDPVerifier")

async def verify_connection(username, password):
    if not username or not password:
        logger.error("❌ Credentials missing. Pass via --username/--password or PROXY_USERNAME/PROXY_PASSWORD env vars.")
        return

    encoded_user = quote(username)
    encoded_pass = quote(password)
    
    # Try query param auth (Standard Bright Data)
    ws_endpoint = f"wss://brd.superproxy.io:9222?auth={encoded_user}:{encoded_pass}"
    
    # Masking for safe logs
    masked_user = username[:8] + "***" if len(username) > 8 else "***"
    logger.info(f"Attempting connection with User: {masked_user}")
    
    async with async_playwright() as p:
        try:
            logger.info("Connecting...")
            browser = await p.chromium.connect_over_cdp(ws_endpoint, timeout=30000)
            logger.info("✅ SUCCESS: Connected to Bright Data Scraping Browser!")
            logger.info(f"Browser Version: {browser.version}")
            await browser.close()
        except Exception as e:
            logger.error("❌ FAILED: Could not connect.")
            logger.error(f"Error: {e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--username", default=os.getenv("PROXY_USERNAME"))
    parser.add_argument("--password", default=os.getenv("PROXY_PASSWORD"))
    args = parser.parse_args()
    
    asyncio.run(verify_connection(args.username, args.password))
