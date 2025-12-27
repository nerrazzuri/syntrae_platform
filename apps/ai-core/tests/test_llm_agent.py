import unittest
from unittest.mock import MagicMock, patch
import os
import json
from ai_core.agents.llm_agent import LLMAgent

class TestLLMAgent(unittest.TestCase):
    def setUp(self):
        self.agent = LLMAgent()

    @patch("ai_core.agents.llm_agent.OpenAI")
    def test_plan_summarize(self, MockOpenAI):
        # Mock OpenAI client
        mock_client = MagicMock()
        MockOpenAI.return_value = mock_client
        
        # Mock responses for ReAct loop
        # 1. Thought: Need to summarize. Action: summarize_context
        # 2. Observation: (simulated by agent loop calling tool)
        # 3. Final Answer: Here is the summary.
        
        # We need to mock the chat.completions.create return values sequentially
        
        # Response 1: Decide to call tool
        resp1 = MagicMock()
        resp1.choices[0].message.content = 'Thought: User wants summary.\nAction: summarize_context\nAction Input: {"query": "vacation"}'
        
        # Response 2: After observation, provide final answer
        resp2 = MagicMock()
        resp2.choices[0].message.content = 'Thought: I have the summary.\nFinal Answer: The vacation policy is generous.'
        
        # Response 3: Reflection
        resp3 = MagicMock()
        resp3.choices[0].message.content = 'The vacation policy is generous (Reflected).'
        
        mock_client.chat.completions.create.side_effect = [resp1, resp2, resp3]
        
        # Mock the tool execution to avoid actual RAG call
        with patch.object(self.agent, "tools") as mock_tools:
            mock_summarize = MagicMock()
            mock_summarize.return_value = {"response": "Mock summary content"}
            mock_tools.return_value = {"summarize_context": mock_summarize}
            
            context = {"tenant_id": "test_tenant"}
            actions = self.agent.plan("Summarize vacation", context)
            
            # Verify tool was called
            mock_summarize.assert_called_once()
            
            # Verify final action
            self.assertEqual(actions[-1]["action"], "final_answer")
            self.assertEqual(actions[-1]["params"]["response"], "The vacation policy is generous (Reflected).")
            
            # Verify steps were captured
            steps = actions[-1]["params"]["steps"]
            self.assertEqual(len(steps), 1)
            self.assertEqual(steps[0]["action"], "summarize_context")

    @patch("ai_core.agents.llm_agent.OpenAI")
    def test_plan_direct_answer(self, MockOpenAI):
        mock_client = MagicMock()
        MockOpenAI.return_value = mock_client
        
        # Response 1: Direct answer
        resp1 = MagicMock()
        resp1.choices[0].message.content = 'Thought: I know this.\nFinal Answer: 42'
        
        # Response 2: Reflection
        resp2 = MagicMock()
        resp2.choices[0].message.content = '42 (Verified)'
        
        mock_client.chat.completions.create.side_effect = [resp1, resp2]
        
        actions = self.agent.plan("What is the meaning of life?", {})
        
        self.assertEqual(actions[-1]["action"], "final_answer")
        self.assertEqual(actions[-1]["params"]["response"], "42 (Verified)")

if __name__ == "__main__":
    unittest.main()
