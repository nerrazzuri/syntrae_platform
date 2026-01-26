
import asyncio
import logging
import os
from urllib.parse import quote
from playwright.async_api import async_playwright

# Setup simple logger
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("CDPVerifier")

async def verify_connection():
    # HARDCODED CREDENTIALS FOR VERIFICATION
    # As provided by user
    username = "brd-customer-hl_e99933d1-zone-scraping_browser1"
    password = "o2p5cq16h4f8"
    
    encoded_user = quote(username)
    encoded_pass = quote(password)
    
    ws_endpoint = f"wss://brd.superproxy.io:9222?auth={encoded_user}:{encoded_pass}"
    masked_endpoint = f"wss://brd.superproxy.io:9222?auth={username[:4]}***:{'***'}"
    
    logger.info(f"Attempting to connect to: {masked_endpoint}")
    
    async with async_playwright() as p:
        try:
            browser = await p.chromium.connect_over_cdp(ws_endpoint, timeout=30000)
            logger.info("✅ SUCCESS: Connected to Bright Data Scraping Browser!")
            logger.info(f"Browser Version: {browser.version}")
            await browser.close()
        except Exception as e:
            logger.error("❌ FAILED: Could not connect.")
            logger.error(f"Error Details: {e}")

if __name__ == "__main__":
    asyncio.run(verify_connection())
