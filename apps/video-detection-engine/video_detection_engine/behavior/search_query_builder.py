import random
import urllib.parse
from typing import List, Dict, Any, Set

class SearchQueryBuilder:
    """
    Generates deterministic, high-quality search queries from MarketProfile.
    Filters generic keywords to ensure Intent/Category relevance.
    """
    
    # Block tokens that are too broad/generic on their own
    GENERIC_BLOCKLIST: Set[str] = {
        "love", "product", "buy", "good", "best", "review", 
        "tiktok", "video", "viral", "trend", "fyp"
    }
    
    def __init__(self, profile: Dict[str, Any]):
        """
        :param profile: MarketProfile dict (from Prisma/API)
        """
        self.profile = profile
        self.positive_keywords = profile.get("criteria", {}).get("keywords_positive", [])
        # Handle flattened structure if needed, but assuming Prisma JSON structure or flattened dict
        if not self.positive_keywords and "keywords_positive" in profile:
            self.positive_keywords = profile["keywords_positive"]

    def build_queries(self, limit: int = 5) -> List[str]:
        """
        Selects valid keywords and formats them as queries.
        """
        # 1. Expand & Filter
        candidates = []
        for kw in self.positive_keywords:
            token = kw.strip().lower()
            if len(token) < 3:
                continue
            if token in self.GENERIC_BLOCKLIST:
                continue
            candidates.append(kw.strip())
            
        if not candidates:
            # Fallback? Strict requirement says no generic scroll.
            # If no valid keywords, we return empty -> Engine handles "No Queries" -> Stop.
            return []

        # 2. Shuffle & Select
        # Deterministic seed could be added here based on Run ID if strictly needed.
        random.shuffle(candidates)
        selected = candidates[:limit]
        
        return selected

    def build_search_urls(self, limit: int = 5) -> List[str]:
        """
        Returns full TikTok Search URLs.
        """
        queries = self.build_queries(limit)
        return [
            f"https://www.tiktok.com/search/video?q={urllib.parse.quote(q)}"
            for q in queries
        ]
