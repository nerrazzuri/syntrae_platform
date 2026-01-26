import asyncio
import os
import logging
import socket
from typing import Optional, Dict, Any, List
from urllib.parse import urlparse, quote

from playwright.async_api import async_playwright, Browser, BrowserContext, Page, Playwright
from playwright_stealth import stealth_async

logger = logging.getLogger(__name__)

class BrowserController:
    """
    Manages the lifecycle of a Playwright browser instance.
    Enforces the Automation Intent Contract: Observer & Extractor only.
    """

    def __init__(self, browser_type: str = "chromium", headless: bool = True, storage_state_path: Optional[str] = None):
        self.browser_type_name = browser_type
        self.headless = headless
        self.storage_state_path = storage_state_path
        self._playwright: Optional[Playwright] = None
        self._browser: Optional[Browser] = None
        self._context: Optional[BrowserContext] = None
        self._page: Optional[Page] = None

    def _mask_secret(self, text: Optional[str]) -> str:
        """Helper to mask secrets in logs."""
        if not text: return "None"
        if len(text) < 4: return "***"
        return f"{text[:2]}***{text[-2:]}"

    async def launch(self):
        """Launches the browser via Bright Data CDP (Remote Browser)."""
        logger.info(f"Connecting to Bright Data CDP ({self.browser_type_name})...")
        self._playwright = await async_playwright().start()
        
        # Bright Data CDP Configuration
        # We rely on PROXY_USERNAME and PROXY_PASSWORD environment variables.
        username = os.getenv("PROXY_USERNAME")
        password = os.getenv("PROXY_PASSWORD")
        
        if not username or not password:
            logger.error("Missing PROXY_USERNAME or PROXY_PASSWORD. Cannot connect to Bright Data.")
            raise RuntimeError("Bright Data credentials missing in environment.")

        # Construct WebSocket Endpoint
        # Endpoint: wss://brd.superproxy.io:9222
        # IMPORTANT: Ensure credentials are URL encoded to handle special characters
        encoded_user = quote(username)
        encoded_pass = quote(password)
        ws_endpoint = f"wss://brd.superproxy.io:9222?auth={encoded_user}:{encoded_pass}"
        
        # Safe Log for Debugging (Mask password)
        masked_endpoint = f"wss://brd.superproxy.io:9222?auth={username[:4]}***:{'***'}"
        logger.info(f"Connecting to CDP Endpoint: {masked_endpoint}")

        try:
            # Connect to Remote Browser
            # Note: We use self._playwright.chromium specifically as Bright Data provides Chromium-based browsers.
            self._browser = await self._playwright.chromium.connect_over_cdp(
                ws_endpoint,
                timeout=60000 # Increased timeout for remote connection
            )
            logger.info("Connected to Bright Data Browser successfully.")
            
        except Exception as e:
            logger.critical(f"Failed to connect to Bright Data CDP: {e}")
            raise

    async def new_context(self, user_agent: Optional[str] = None, locale: str = "en-MY"):
        """Creates a new isolated browser context. Forces DESKTOP mode."""
        if not self._browser:
            raise RuntimeError("Browser not launched. Call launch() first.")
        
        logger.info("Creating new browser context (DESKTOP mode)...")
        
        # CRITICAL: Fallback User Agent (Windows + Chrome 120+)
        if not user_agent:
            user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        
        # Base arguments (Timezone alignment is critical for TikTok)
        context_args = {
            "locale": locale,
            "timezone_id": "Asia/Kuala_Lumpur", # Aligned with en-MY
            "permissions": ["geolocation"],
            "user_agent": user_agent,
            "viewport": {"width": 1280, "height": 720}, # Standard desktop
            "device_scale_factor": 1,
            "has_touch": False,
            "is_mobile": False
        }

        if self.storage_state_path and os.path.exists(self.storage_state_path):
            logger.info(f"Loading session from {self.storage_state_path}")
            context_args["storage_state"] = self.storage_state_path

        self._context = await self._browser.new_context(**context_args)
        
        # Anti-detect: Context Level Injection
        await self._context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'languages', { get: () => ['en-MY', 'en-US', 'en'] });
        """)
        
        self._page = await self._context.new_page()
        
        # Anti-detect: Stealth Plugin
        await stealth_async(self._page)
        
        logger.info("Context created (Stealth + Timezone Enabled).")

        # Removed ThorData/ASN Verification logic as requested for Bright Data Integration.


        # WARM-UP NAVIGATION
        logger.info("Performing warm-up navigation...")
        try:
            await self._page.goto("https://www.tiktok.com/foryou", wait_until="domcontentloaded", timeout=45000)
            logger.info("Warm-up page loaded. Waiting 3 seconds...")
            await asyncio.sleep(3)
            logger.info("Warm-up completed.")
        except Exception as e:
            logger.warning(f"Warm-up navigation encountered an issue (non-fatal): {e}")

    async def navigate(self, url: str):
        """Safe navigation primitive."""
        if not self._page:
            raise RuntimeError("No active page. Call new_context() first.")
        
        logger.info(f"Navigating to {url}...")
        try:
            await self._page.goto(url, wait_until="domcontentloaded", timeout=30000)
        except Exception as e:
            logger.error(f"Navigation failed: {e}")
            raise

    async def save_storage_state(self, path: Optional[str] = None):
        """Persists the current browser context state (cookies, storage) to disk."""
        target = path or self.storage_state_path
        if not target:
            raise ValueError("No storage path specified.")
        
        if self._context:
            await self._context.storage_state(path=target)
            logger.info(f"Session saved to {target}")

    async def close(self):
        """Clean shutdown."""
        if self._context:
            await self._context.close()
        if self._browser:
            await self._browser.close()
        if self._playwright:
            await self._playwright.stop()
        logger.info("Browser automation closed.")

    # --- Primitives for Platform Adapters ---
    
    @property
    def page(self) -> Page:
        if not self._page:
            raise RuntimeError("Page not initialized.")
        return self._page
