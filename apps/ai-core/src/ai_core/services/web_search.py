from __future__ import annotations

from typing import List, Dict
import os


def search(query: str, max_results: int = 3) -> List[Dict[str, str]]:
    """
    Best-effort web search. If SERPAPI_KEY is present, use SerpAPI HTTP endpoint;
    otherwise return an empty list (feature effectively disabled at runtime).
    """
    api_key = os.getenv("SERPAPI_KEY")
    if not api_key or not query:
        return []
    try:
        import requests

        params = {
            "engine": "google",
            "q": query,
            "api_key": api_key,
            "num": max(1, int(max_results)),
        }
        r = requests.get("https://serpapi.com/search", params=params, timeout=10)
        r.raise_for_status()
        data = r.json()
        results = []
        for item in (data.get("organic_results") or [])[: max_results]:
            results.append(
                {
                    "title": item.get("title", ""),
                    "snippet": item.get("snippet", ""),
                    "link": item.get("link", ""),
                }
            )
        return results
    except Exception:
        return []


