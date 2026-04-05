import random
import urllib.parse
from typing import List, Dict, Any, Set

COUNTRY_ALIASES: Dict[str, List[str]] = {
    "MY": ["malaysia", "kuala lumpur", "马来西亚"],
    "SG": ["singapore", "sg", "新加坡"],
    "ID": ["indonesia", "jakarta", "印尼"],
    "TH": ["thailand", "bangkok", "泰国"],
    "PH": ["philippines", "manila", "菲律宾"],
    "VN": ["vietnam", "ho chi minh", "越南"],
}

COUNTRY_GEO_HINTS: Dict[str, List[str]] = {
    "MY": ["malaysia", "malaysian", "kuala lumpur", "kl", "selangor", "penang", "johor", "johor bahru", "jb", "petaling jaya", "pj", "sabah", "sarawak", "马来西亚", "吉隆坡", "槟城", "柔佛"],
    "SG": ["singapore", "singaporean", "sg", "新加坡"],
    "ID": ["indonesia", "indonesian", "jakarta", "bandung", "surabaya", "印尼", "印度尼西亚"],
    "TH": ["thailand", "thai", "bangkok", "phuket", "泰国", "曼谷"],
    "PH": ["philippines", "filipino", "manila", "cebu", "菲律宾", "马尼拉"],
    "VN": ["vietnam", "vietnamese", "ho chi minh", "hanoi", "越南", "胡志明"],
}

REGION_TARGETS: Dict[str, List[str]] = {
    "SEA": ["MY", "SG", "ID", "TH", "PH", "VN"],
}

REGION_ALIASES: Dict[str, List[str]] = {
    "SEA": ["southeast asia", "sea", "asean", "东南亚"],
}

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
        self.geo_mode = str(profile.get("geo_mode", "COUNTRY") or "COUNTRY").strip().upper()
        self.geo_targets = [
            str(target).strip().upper()
            for target in profile.get("geo_targets", []) or []
            if str(target).strip()
        ]
        self.geo_strictness = str(profile.get("geo_strictness", "BALANCED") or "BALANCED").strip().upper()

    def _expanded_country_targets(self) -> List[str]:
        if self.geo_mode == "REGION":
            countries: List[str] = []
            for target in self.geo_targets:
                countries.extend(REGION_TARGETS.get(target, []))
            return list(dict.fromkeys(countries))
        if self.geo_mode == "COUNTRY":
            return [target for target in self.geo_targets if target in COUNTRY_ALIASES]
        return []

    def _geo_query_terms(self) -> List[str]:
        if self.geo_mode == "GLOBAL":
            return []

        terms: List[str] = []
        if self.geo_mode == "REGION":
            for target in self.geo_targets:
                terms.extend(REGION_ALIASES.get(target, []))
                for country in REGION_TARGETS.get(target, []):
                    aliases = COUNTRY_ALIASES.get(country, [])
                    if aliases:
                        terms.append(aliases[0])
        else:
            for target in self._expanded_country_targets():
                aliases = COUNTRY_ALIASES.get(target, [])
                if aliases:
                    terms.append(aliases[0])

        # Keep ordering stable while removing duplicates.
        return list(dict.fromkeys(term for term in terms if term))

    def _geo_text_hints(self) -> List[str]:
        if self.geo_mode == "GLOBAL":
            return []

        hints: List[str] = []
        if self.geo_mode == "REGION":
            for target in self.geo_targets:
                hints.extend(REGION_ALIASES.get(target, []))
                for country in REGION_TARGETS.get(target, []):
                    hints.extend(COUNTRY_GEO_HINTS.get(country, []))
        else:
            for country in self._expanded_country_targets():
                hints.extend(COUNTRY_GEO_HINTS.get(country, []))
        return list(dict.fromkeys(hint for hint in hints if hint))

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

        geo_terms = self._geo_query_terms()
        selected: List[str] = []
        seen_queries: Set[str] = set()

        def push(query: str):
            normalized = query.strip().lower()
            if not normalized or normalized in seen_queries:
                return
            seen_queries.add(normalized)
            selected.append(query.strip())

        for idx, kw in enumerate(candidates):
            if len(selected) >= limit:
                break
            if geo_terms:
                geo_term = geo_terms[idx % len(geo_terms)]
                push(f"{kw} {geo_term}")
            if self.geo_strictness != "STRICT":
                push(kw)
            if len(selected) >= limit:
                break

        return selected[:limit]

    def build_search_urls(self, limit: int = 5) -> List[str]:
        """
        Returns full TikTok Search URLs.
        """
        queries = self.build_queries(limit)
        return [
            f"https://www.tiktok.com/search/video?q={urllib.parse.quote(q)}"
            for q in queries
        ]

    def evaluate_geo_candidate(self, candidate: Dict[str, Any], query: str) -> Dict[str, Any]:
        if self.geo_mode == "GLOBAL":
            return {
                "status": "GLOBAL",
                "allowed": True,
                "reasons": ["GLOBAL_SCOPE"],
            }

        text_parts = [
            str(candidate.get("caption") or candidate.get("title") or "").lower(),
            str(candidate.get("video_author_name") or candidate.get("author") or "").lower(),
            str(candidate.get("page_url") or candidate.get("video_url") or "").lower(),
        ]
        combined_text = " ".join(part for part in text_parts if part)
        match_reasons: List[str] = []

        for hint in self._geo_text_hints():
            hint_lower = hint.lower()
            if hint_lower and hint_lower in combined_text:
                match_reasons.append(f"GEO_TEXT:{hint}")

        for term in self._geo_query_terms():
            term_lower = term.lower()
            if term_lower and term_lower in str(query or "").lower():
                match_reasons.append(f"GEO_QUERY:{term}")

        match_reasons = list(dict.fromkeys(match_reasons))
        has_text_match = any(reason.startswith("GEO_TEXT:") for reason in match_reasons)
        has_query_match = any(reason.startswith("GEO_QUERY:") for reason in match_reasons)

        if has_text_match:
            status = "CONFIRMED_MATCH"
            allowed = True
        elif has_query_match:
            status = "LIKELY_MATCH"
            allowed = self.geo_strictness != "STRICT"
        elif self.geo_strictness == "BROAD":
            status = "UNKNOWN"
            allowed = True
        else:
            status = "OUTSIDE_TARGET"
            allowed = False

        return {
            "status": status,
            "allowed": allowed,
            "reasons": match_reasons or ["NO_GEO_SIGNAL"],
        }
