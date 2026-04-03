import unittest
from unittest.mock import MagicMock, patch
from ai_core.services.lead_scoring_service import LeadScoringService, BuyerStage, RecommendedAction
from ai_core.services.brand_service import BrandService, BrandNotFoundError, BrandInactiveError

class TestDomainScoring(unittest.TestCase):

    def setUp(self):
        self.service = LeadScoringService()
        self.base_context = {
            "platform": "instagram",
            "comment_id": "c1",
            "video_id": "v1",
            "source_event_id": "e1",
            "account_id": "acc1",
            "user_handle": "user1"
        }

    @patch('ai_core.services.lead_scoring_service.SessionLocal')
    @patch('ai_core.services.lead_scoring_service.BrandService.get_brand_context')
    def test_legacy_behavior_empty_context(self, mock_get_context, mock_session_cls):
        """Test 1: Legacy Behavior (Empty Context) -> No score change."""
        mock_get_context.return_value = {}
        
        # Mock DB
        mock_db = MagicMock()
        mock_session_cls.return_value.__enter__.return_value = mock_db
        
        # Input that triggers EVALUATING (confidence usually determined by AI signal)
        text = "Is this worth the price?"
        signals = [{"type": "VALUE_EVALUATION", "confidence": 0.5}]
        context = {**self.base_context, "brand_id": "brand1"}

        lead = self.service.evaluate_and_persist(text, signals, context)
        
        self.assertIsNotNone(lead)
        self.assertEqual(lead.confidence, 0.5) # Unchanged
        self.assertEqual(lead.buyer_stage, BuyerStage.EVALUATING)

    @patch('ai_core.services.lead_scoring_service.SessionLocal')
    @patch('ai_core.services.lead_scoring_service.BrandService.get_brand_context')
    def test_domain_boost_keywords(self, mock_get_context, mock_session_cls):
        """Test 2: Domain Boost (Keywords) -> Confidence Increased."""
        mock_get_context.return_value = {
            "keywords": ["matte", "shade"]
        }
        
        mock_db = MagicMock()
        mock_session_cls.return_value.__enter__.return_value = mock_db

        text = "I love this matte finish."
        # Base confidence 0.6 from AI
        signals = [{"type": "AESTHETIC_PREFERENCE", "confidence": 0.6}]
        context = {**self.base_context, "brand_id": "brand1"}

        lead = self.service.evaluate_and_persist(text, signals, context)
        
        self.assertIsNotNone(lead)
        # Expected: 0.6 + 0.1 (keyword boost) = 0.7
        self.assertAlmostEqual(lead.confidence, 0.7)

    @patch('ai_core.services.lead_scoring_service.SessionLocal')
    @patch('ai_core.services.lead_scoring_service.BrandService.get_brand_context')
    def test_negative_signal_penalty(self, mock_get_context, mock_session_cls):
        """Test 3: Negative Signals -> Confidence Decreased."""
        mock_get_context.return_value = {
            "negative_signals": ["oily", "greasy"]
        }
        
        mock_db = MagicMock()
        mock_session_cls.return_value.__enter__.return_value = mock_db
        
        text = "It looks too oily for me."
        signals = [{"type": "VALUE_EVALUATION", "confidence": 0.8}]
        context = {**self.base_context, "brand_id": "brand1"}

        lead = self.service.evaluate_and_persist(text, signals, context)
        
        self.assertIsNotNone(lead)
        # Expected: 0.8 - 0.15 (penalty) = 0.65
        self.assertAlmostEqual(lead.confidence, 0.65)

    @patch('ai_core.services.lead_scoring_service.SessionLocal')
    @patch('ai_core.services.lead_scoring_service.BrandService.get_brand_context')
    def test_boost_cap(self, mock_get_context, mock_session_cls):
        """Test 4: Boost Cap -> Max adjustment limited to 0.25."""
        mock_get_context.return_value = {
            "keywords": ["love"],
            "confidence_boosts": {"perfect": 0.2, "amazing": 0.2} 
        }
        
        mock_db = MagicMock()
        mock_session_cls.return_value.__enter__.return_value = mock_db
        
        # Total calculated boost: 0.1 (keyword) + 0.2 + 0.2 = 0.5
        # Cap should limit to 0.25
        
        text = "I love this, it is perfect and amazing!"
        signals = [{"type": "AESTHETIC_PREFERENCE", "confidence": 0.5}]
        context = {**self.base_context, "brand_id": "brand1"}

        lead = self.service.evaluate_and_persist(text, signals, context)
        
        self.assertIsNotNone(lead)
        # Expected: 0.5 + 0.25 (cap) = 0.75
        self.assertAlmostEqual(lead.confidence, 0.75)

    @patch('ai_core.services.lead_scoring_service.SessionLocal')
    @patch('ai_core.services.lead_scoring_service.BrandService.get_brand_context')
    def test_safety_paused_brand(self, mock_get_context, mock_session_cls):
        """Test 5: Brand Safety -> Paused Brand aborts processing (returns None)."""
        mock_get_context.side_effect = BrandInactiveError("Brand PAUSED")
        
        mock_db = MagicMock()
        mock_session_cls.return_value.__enter__.return_value = mock_db
        
        text = "I want to buy this."
        signals = [{"type": "PRODUCT_INQUIRY", "confidence": 0.9}]
        context = {**self.base_context, "brand_id": "brand_paused"}

        lead = self.service.evaluate_and_persist(text, signals, context)
        
        self.assertIsNone(lead) # Aborted

    @patch('ai_core.services.lead_scoring_service.SessionLocal')
    @patch('ai_core.services.lead_scoring_service.BrandService.get_brand_context')
    def test_safety_missing_brand(self, mock_get_context, mock_session_cls):
         """Test 6: Brand Safety -> Missing Brand aborts processing."""
         mock_get_context.side_effect = BrandNotFoundError("Brand Not Found")
         
         mock_db = MagicMock()
         mock_session_cls.return_value.__enter__.return_value = mock_db
         
         text = "I want to buy this."
         signals = [{"type": "PRODUCT_INQUIRY", "confidence": 0.9}]
         context = {**self.base_context, "brand_id": "brand_missing"}

         lead = self.service.evaluate_and_persist(text, signals, context)
         
         self.assertIsNone(lead)

    @patch('ai_core.services.lead_scoring_service.SessionLocal')
    @patch('ai_core.services.lead_scoring_service.BrandService.get_brand_context')
    def test_determinism(self, mock_get_context, mock_session_cls):
        """Test 7: Determinism -> Same input gives same output."""
        mock_get_context.return_value = {"keywords": ["stable"]}
        
        mock_db = MagicMock()
        mock_session_cls.return_value.__enter__.return_value = mock_db # Must mock for both calls to succeed
        
        text = "stable result"
        signals = [{"type": "AWARENESS", "confidence": 0.5}]
        context = {**self.base_context, "brand_id": "brand1"}

        lead1 = self.service.evaluate_and_persist(text, signals, context)
        lead2 = self.service.evaluate_and_persist(text, signals, context)
        
        self.assertEqual(lead1.confidence, lead2.confidence)
        self.assertEqual(lead1.buyer_stage, lead2.buyer_stage)
