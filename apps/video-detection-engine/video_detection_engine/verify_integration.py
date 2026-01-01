
import asyncio
import logging
from unittest.mock import MagicMock, patch
from integration.client import IntegrationClient

# Configure Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("Verification")

async def verify_relevance_loop():
    logger.info("Verifying IntegrationClient Relevance Loop...")
    
    # Mock Credentials
    client = IntegrationClient(brand_id="test-brand", install_id="test-agent")
    
    # Test Data
    mock_text = "I love this skincare routine!"
    mock_platform = "tiktok"
    mock_meta = {"author": "user1"}
    
    # 1. Test Relevance Check (Hit)
    with patch("httpx.AsyncClient.post") as mock_post:
        # Mock Response
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "relevant": True, 
            "confidence": 0.85, 
            "reason": "good match"
        }
        mock_post.return_value = mock_response
        
        result = await client.check_relevance(mock_text, mock_platform, mock_meta)
        
        assert result["relevant"] is True
        assert result["confidence"] == 0.85
        logger.info("✅ Relevance Check (Hit) Passed")
        
    # 2. Test Relevance Check (Miss)
    with patch("httpx.AsyncClient.post") as mock_post:
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "relevant": False, 
            "confidence": 0.2, 
            "reason": "low intent"
        }
        mock_post.return_value = mock_response
        
        result = await client.check_relevance("random video", mock_platform, mock_meta)
        
        assert result["relevant"] is False
        logger.info("✅ Relevance Check (Miss) Passed")

    # 3. Test Event Emission
    with patch("httpx.AsyncClient.post") as mock_post:
        mock_response = MagicMock()
        mock_response.status_code = 202
        mock_response.json.return_value = {"event_id": "evt_123"}
        mock_post.return_value = mock_response
        
        data = {
            "platform": "tiktok",
            "content_text": "Buy this now!",
            "video_id": "vid_1",
            "comment_id": "com_1"
        }
        
        await client.emit_event("DESKTOP_CAPTURE", data)
        logger.info("✅ Event Emission Passed")

if __name__ == "__main__":
    asyncio.run(verify_relevance_loop())
