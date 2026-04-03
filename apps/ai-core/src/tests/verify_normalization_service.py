
import unittest
import sys
import os
import json
from unittest.mock import MagicMock, patch

# Add src to path
sys.path.append(os.path.join(os.getcwd(), "apps/ai-core/src"))

from ai_core.services.normalization_service import NormalizationService, NormalizationResult

class TestNormalizationService(unittest.TestCase):
    def setUp(self):
        self.service = NormalizationService()
        self.service.llm_client = MagicMock()
        # Mock LLM response for generic cases
        self.service.llm_client.generate.return_value = {"text": "normalized by llm"}
        
        # Load Golden Dataset
        dataset_path = os.path.join(os.getcwd(), "apps/ai-core/src/tests/data/normalization_golden.json")
        with open(dataset_path, "r") as f:
            self.golden_data = json.load(f)

    def test_golden_dataset_regression(self):
        """Run all cases in Gold Set"""
        for case in self.golden_data:
            with self.subTest(case_id=case["id"]):
                # Mock LLM if expected
                if case.get("should_use_llm"):
                     # If specific LLM output needed, we'd need to mock per case. 
                     # For now, we assume DICT/PHRASE logic covers most, 
                     # or we relax expectation if method is LLM.
                     pass 
                
                result = self.service.normalize(case["raw_text"])
                
                # Check Normalized Text (Loose match if LLM involved, strict if DICT)
                if not case.get("should_use_llm") and case.get("expected_method") != "LLM":
                     # For SAFE_MS_1: "sy nak beli" -> "i want beli". "beli" not in dict yet?
                     # Wait, I didn't add "beli" to SAFE_TOKEN_RULES? 
                     # Checking rules... "beli ke" is PHRASE. "beli" alone? 
                     # If "beli" not in rules, it stays "beli".
                     # "sy"->i, "nak"->want.
                     # Expectation: "i want beli".
                     # Normalization result logic: join tokens.
                     self.assertEqual(result.normalized_text.strip(), case["expected_normalized"].strip())
                
                # Check Metadata Contract
                self.assertIn("normalization_meta", result.to_dict())
                meta = result.meta
                self.assertIn("version", meta)
                self.assertIn("method", meta)
                self.assertIn("confidence", meta)
                self.assertIn("rules_fired", meta)
                self.assertIn("warnings", meta)
                
                # Check Warnings
                if "expected_warnings" in case:
                    for warn in case["expected_warnings"]:
                        self.assertIn(warn, meta["warnings"])

    def test_output_contract_fields(self):
        result = self.service.normalize("test")
        d = result.to_dict()
        self.assertIn("raw_text", d)
        self.assertIn("normalized_text", d)
        self.assertIn("normalization_meta", d)
        
        meta = d["normalization_meta"]
        self.assertEqual(meta["version"], "v1.1.0")
        self.assertTrue(isinstance(meta["rules_fired"], list))
        self.assertTrue(isinstance(meta["warnings"], list))

if __name__ == '__main__':
    unittest.main()
