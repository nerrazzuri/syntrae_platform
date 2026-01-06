
import asyncio
import os
import logging
from typing import Optional, Dict, Any, List
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

    async def launch(self):
        """Launches the browser engine."""
        logger.info(f"Launching {self.browser_type_name} (headless={self.headless})...")
        self._playwright = await async_playwright().start()
        
        browser_launcher = getattr(self._playwright, self.browser_type_name)
        self._browser = await browser_launcher.launch(
            headless=self.headless,
            args=["--disable-blink-features=AutomationControlled"]  # Basic anti-detect
        )
        logger.info("Browser launched successfully.")

    async def new_context(self, user_agent: Optional[str] = None, locale: str = "en-US"):
        """Creates a new isolated browser context."""
        if not self._browser:
            raise RuntimeError("Browser not launched. Call launch() first.")
        
        logger.info("Creating new browser context...")
        context_args = {
            "user_agent": user_agent,
            "locale": locale,
            "viewport": {"width": 1280, "height": 720}, # Standard desktop
            "device_scale_factor": 1
        }

        if self.storage_state_path and os.path.exists(self.storage_state_path):
            logger.info(f"Loading session from {self.storage_state_path}")
            context_args["storage_state"] = self.storage_state_path

        self._context = await self._browser.new_context(**context_args)
        self._page = await self._context.new_page()
        
        # Anti-detect: Stealth Plugin (Overrides webdriver, chrome properties, etc.)
        await stealth_async(self._page)
        
        # Additional manual overrides if stealth misses them (Redundant but safe)
        await self._page.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
        """)
        logger.info("Context created (Stealth Enabled).")

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
