
import asyncio
import os
import logging
import socket
from typing import Optional, Dict, Any, List
from urllib.parse import urlparse

import httpx
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

        # --- Proxy Configuration (Env Based) ---
        # EXPECTED: http://host:port (e.g. http://t.pr.thordata.net:9999)
        self.proxy_server = os.getenv("PROXY_SERVER") 
        self.proxy_username = os.getenv("PROXY_USERNAME")
        self.proxy_password = os.getenv("PROXY_PASSWORD")
        
        # Enable by default if server is set, unless explicitly disabled
        enabled_str = os.getenv("PROXY_ENABLED", "true").lower()
        self.proxy_enabled = bool(self.proxy_server and enabled_str == "true")
        
        # Cloud providers to Reject
        self.blocked_asns = ["Hetzner", "Amazon", "AWS", "Google", "GCP", "Oracle", "OCI", "Microsoft", "Azure", "DigitalOcean"]

    def _mask_secret(self, text: Optional[str]) -> str:
        """Helper to mask secrets in logs."""
        if not text: return "None"
        if len(text) < 4: return "***"
        return f"{text[:2]}***{text[-2:]}"

    async def launch(self):
        """Launches the browser engine with hardened arguments."""
        logger.info(f"Launching {self.browser_type_name} (headless={self.headless})...")
        self._playwright = await async_playwright().start()
        
        browser_launcher = getattr(self._playwright, self.browser_type_name)
        
        # Hardened Arguments (Minimal Safe Set)
        hardened_args = [
            "--disable-blink-features=AutomationControlled",
            "--no-sandbox",
            "--disable-dev-shm-usage",
        ]

        # Conditionally pass proxy only if enabled
        launch_kwargs = {
            "headless": self.headless,
            "args": hardened_args
        }
        
        if self.proxy_enabled:
            # Construct Playwright Proxy Dict
            proxy_config = {
                "server": self.proxy_server
            }
            if self.proxy_username and self.proxy_password:
                proxy_config["username"] = self.proxy_username
                proxy_config["password"] = self.proxy_password
                
            launch_kwargs["proxy"] = proxy_config
            logger.info(f"Launching with HTTP Proxy: {self.proxy_server} (User: {self._mask_secret(self.proxy_username)})")
        else:
            logger.info("Launching SANS PROXY (Direct Connection).")

        self._browser = await browser_launcher.launch(**launch_kwargs)
        logger.info("Browser launched successfully.")

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

        # PROXY VERIFICATION & ASN CHECK
        # We use API context to check the effective exit IP of the browser context
        if self.proxy_enabled:
            logger.info("Verifying Proxy Connectivity & ASN...")
            try:
                # Use the context's request (shares proxy)
                api_response = await self._context.request.get("https://ipinfo.io/json")
                if not api_response.ok:
                     raise RuntimeError(f"IP verify failed: {api_response.status} {api_response.status_text}")
                
                data = await api_response.json()
                ip = data.get("ip", "Unknown")
                org = data.get("org", "Unknown")
                country = data.get("country", "Unknown")
                
                logger.info(f"EXIT IP: {ip} | ORG: {org} | CN: {country}")
                
                # REJECT CLOUD PROVIDERS
                for blocked in self.blocked_asns:
                    if blocked.lower() in org.lower():
                        raise RuntimeError(f"Detected Cloud/Datacenter ASN ({blocked}): {org}. Residential Proxy Required.")
                        
                logger.info("Proxy Verification PASSED (Residential Check OK).")
                
            except Exception as e:
                logger.critical(f"Proxy Verification FAILED: {e}")
                await self.close()
                raise RuntimeError(f"Browser could not verify proxy connection: {e}")

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
