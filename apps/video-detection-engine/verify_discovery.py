import asyncio
import sys
import os
from unittest.mock import MagicMock, AsyncMock

# Add path
sys.path.append(os.path.abspath("apps/video-detection-engine"))

from video_detection_engine.video_engine.discovery import DiscoveryEngine
from video_detection_engine.integration.client import IntegrationClient

async def test_discovery():
    print("Testing DiscoveryEngine...")
    
    # Mock Client
    mock_client = MagicMock(spec=IntegrationClient)
    mock_client.get_market_profiles = AsyncMock(return_value=[
        {
            "id": "p1", "name": "Test Profile", "is_active": True, "status": "ACTIVE", "version": 1,
            "keywords_positive": ["organic"], "hashtags_positive": ["#wellness"]
        }
    ])
    
    # Mock Score with side effects based on input
    async def mock_score(text, hashtags, platform):
        text_lower = text.lower()
        if "scam" in text_lower:
            return {"score": 0.0, "is_match": False, "reasons": ["BLOCKED"]}
        if "organic" in text_lower:
            return {"score": 0.8, "is_match": True, "reasons": ["Match"]}
        return {"score": 0.1, "is_match": False, "reasons": ["Low Score"]}
        
    mock_client.score_content = AsyncMock(side_effect=mock_score)
    
    engine = DiscoveryEngine(mock_client)
    
    print("Initializing...")
    await engine.initialize()
    assert engine.active_profile["id"] == "p1"
    print("Profile Loaded.")
    
    print("Running Cycle...")
    results = await engine.run_discovery_cycle()
    
    print(f"Results Found: {len(results)}")
    
    # Expect 1 match (the organic one from the mock in discovery.py)
    # logic in discovery.py has 3 mock candidates:
    # 1. "I love organic skincare! #wellness" -> Should Match
    # 2. "This product is a scam. #ad" -> Should Block
    # 3. "Check out my new routine." -> Low Score
    
    assert len(results) == 1
    assert results[0]["id"] == "123"
    print("SUCCESS: Discovery Logic Verified")

if __name__ == "__main__":
    asyncio.run(test_discovery())
