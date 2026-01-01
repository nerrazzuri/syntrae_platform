import logging
from typing import List, Optional, Tuple, Dict, Any
from sqlalchemy.orm import Session
from shared.database.models import MarketProfile, MarketProfileStatus
from shared.database.session import SessionLocal

logger = logging.getLogger(__name__)

class MarketMatchService:
    """
    Service to evaluate content relevance against a Brand's Active Market Profile.
    This provides a deterministic 'Market Match Score' (0.0 - 1.0) used for gating.
    """

    def __init__(self):
        pass

    def get_active_profile(self, brand_id: str, db: Session) -> Optional[MarketProfile]:
        """Fetch the currently ACTIVE profile for a brand."""
        return db.query(MarketProfile).filter(
            MarketProfile.brand_id == brand_id,
            MarketProfile.is_active == True,
            MarketProfile.status.in_([MarketProfileStatus.ACTIVE, MarketProfileStatus.READY])
        ).first()

    def score_content(self, text: str, hashtags: List[str], profile: MarketProfile) -> Tuple[float, List[str]]:
        """
        Score content against a profile.
        Returns: (score, reasons)
        Score is 0.0 - 1.0.
        """
        reasons = []
        text_lower = text.lower()
        
        # 1. Negative Blocking (Safety) - Phase 37.5 Requirement
        # Check Negative Keywords
        for neg_kw in profile.keywords_negative or []:
            if neg_kw.lower() in text_lower:
                return 0.0, [f"BLOCKED: Negative Keyword '{neg_kw}'"]

        # Check Negative Hashtags
        # Hashtags input might be list of strings.
        content_tags_lower = [t.lower().replace('#', '') for t in hashtags]
        for neg_tag in profile.hashtags_negative or []:
            clean_neg = neg_tag.lower().replace('#', '')
            if clean_neg in content_tags_lower:
                 return 0.0, [f"BLOCKED: Negative Hashtag '#{clean_neg}'"]

        # Check Excluded Topics (Simple keyword match for now)
        for topic in profile.excluded_topics or []:
            if topic.lower() in text_lower:
                return 0.0, [f"BLOCKED: Excluded Topic '{topic}'"]

        # 2. Positive Scoring
        score = 0.0
        
        # Keywords
        # We count unique matches to avoid spamming same keyword
        matched_keywords = [kw for kw in (profile.keywords_positive or []) if kw.lower() in text_lower]
        unique_matches = len(set(matched_keywords))
        
        # Weighting: 
        # If weight_keyword is 0.5, we want to reach full contribution with say 3 keywords?
        # Let's assume saturation at 3 keywords.
        w_k = profile.weight_keyword if profile.weight_keyword is not None else 0.5
        k_score = min(unique_matches / 3.0, 1.0) * w_k
        if unique_matches > 0:
            reasons.append(f"matched {unique_matches} keywords")
            score += k_score

        # Hashtags
        # Saturation at 2 hashtags?
        w_h = profile.weight_hashtag if profile.weight_hashtag is not None else 0.3
        matched_hashtags = [t for t in (profile.hashtags_positive or []) if t.lower().replace('#','') in content_tags_lower]
        unique_tags = len(set(matched_hashtags))
        
        h_score = min(unique_tags / 2.0, 1.0) * w_h
        if unique_tags > 0:
            reasons.append(f"matched {unique_tags} hashtags")
            score += h_score
            
        # 3. Language Check (Bonus/Penalty?)
        # For now, maybe strict filter if language detection is available?
        # Assuming we don't have language in input for this specific method, or we assume text is valid.
        # We'll skip for now or treat as pre-filter.
        
        # 4. Discovery Intent Multiplier?
        # Aggressive -> Boost score? Or Threshold is lower?
        # Usually Intent defines the Threshold, not the Score.
        # So Score stays objective. Threshold changes.
        
        return min(round(score, 2), 1.0), reasons

    def evaluate_relevance(self, brand_id: str, text: str, hashtags: List[str]) -> Dict[str, Any]:
        """
        Full evaluation flow including DB lookup.
        Returns: { score: float, reasons: [], profile_version: int, threshold: float, is_match: bool }
        """
        with SessionLocal() as db:
            profile = self.get_active_profile(brand_id, db)
            if not profile:
                 return {
                     "score": 0.0, 
                     "reasons": ["NO_ACTIVE_PROFILE"], 
                     "is_match": False,
                     "profile_version": None
                 }
            
            score, reasons = self.score_content(text, hashtags, profile)
            
            # Threshold logic
            threshold = profile.acceptance_threshold if profile.acceptance_threshold is not None else 0.6
            is_match = score >= threshold
            
            if not is_match and score > 0:
                reasons.append(f"Score {score} below threshold {threshold}")
            
            return {
                "score": score,
                "reasons": reasons,
                "is_match": is_match,
                "profile_version": profile.version,
                "profile_id": profile.id,
                "threshold": threshold
            }
