import sys
import os

# Adjust path to find modules
sys.path.append(os.path.abspath("apps/ai-core/src"))

from shared.database.models import MarketProfile
from ai_core.services.market_match_service import MarketMatchService

def test_scoring():
    service = MarketMatchService()
    
    profile = MarketProfile(
        id="test-profile",
        keywords_positive=["organic", "vegan", "gluten free"],
        keywords_negative=["scam", "cheap"],
        hashtags_positive=["#healthy", "#wellness"],
        hashtags_negative=["#ad"],
        excluded_topics=["politics"],
        weight_keyword=0.5,
        weight_hashtag=0.5
    )
    
    print("Testing Blockers...")
    s, r = service.score_content("This is a cheap scam product", [], profile)
    print(f"Negative Keyword: {s} (Exp: 0.0) -> {r}")
    assert s == 0.0
    
    s, r = service.score_content("Great product", ["#ad"], profile)
    print(f"Negative Hashtag: {s} (Exp: 0.0) -> {r}")
    assert s == 0.0
    
    print("\nTesting Scoring...")
    # 1 keyword match (1/3 * 0.5 = 0.166)
    s, r = service.score_content("I love organic food", [], profile)
    print(f"1 KW: {s} -> {r}")
    assert s > 0.15
    
    # 2 keyword matches (2/3 * 0.5 = 0.33) + 1 Hashtag (1/2 * 0.5 = 0.25) = 0.58
    s, r = service.score_content("organic and vegan options", ["#healthy"], profile)
    print(f"2 KW + 1 HT: {s} -> {r}")
    assert s > 0.5
    
    print("\nSUCCESS: Logic Verified")

if __name__ == "__main__":
    try:
        test_scoring()
    except AssertionError as e:
        print("FAILED")
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: {e}")
        sys.exit(1)
