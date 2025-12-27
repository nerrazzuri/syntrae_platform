import sys
import os
from unittest.mock import MagicMock, patch

# Add src to path
sys.path.append("backend/src")

from ai_core.pipeline.rag_pipeline import RAGPipeline
from shared.database.models import Tenant

def test_dynamic_system_prompt():
    print("Testing Dynamic System Prompt...")

    # Mock DB Session
    mock_db = MagicMock()
    
    # Mock Tenant with custom system prompt
    tenant_id = "tenant-pirate"
    mock_tenant = Tenant(
        id=tenant_id,
        name="Pirate Corp",
        settings={"system_prompt": "You are a pirate. Always answer with 'Arr' and 'matey'."}
    )
    
    # Setup query return
    mock_query = MagicMock()
    mock_query.filter.return_value.first.return_value = mock_tenant
    mock_db.query.return_value = mock_query

    # Initialize Pipeline
    pipe = RAGPipeline()
    
    # Mock Retriever to return some context (so we don't hit Qdrant)
    pipe.retriever.retrieve_all = MagicMock(return_value={
        "bm25_texts": ["The treasure is buried under the palm tree."],
        "dense_hits": [{"content": "The treasure is buried under the palm tree.", "score": 0.9}],
        "field_value_hits": []
    })
    
    # Mock other components to avoid side effects
    pipe.intent_router.classify = MagicMock(return_value=MagicMock(intent="lookup", confidence=1.0))
    pipe.schema_expander.expand = MagicMock(return_value={})
    pipe.fusion.fuse = MagicMock(return_value=["The treasure is buried under the palm tree."])
    pipe.cross_reranker.rerank = MagicMock(return_value=["The treasure is buried under the palm tree."])
    pipe.schema_bias.apply = MagicMock(return_value=["The treasure is buried under the palm tree."])
    
    # Mock LLMClient to avoid actual API call (optional, but better to test flow first)
    # Actually, we WANT to test if the system_prompt is passed to LLMClient.
    # So we should mock the internal _llm of response_formatter and check the call args.
    
    mock_llm = MagicMock()
    mock_llm.generate.return_value = {"text": "Arr, the treasure be under the tree, matey!", "used": True}
    pipe.response_formatter._llm = mock_llm

    # Run Pipeline
    print("Running pipeline.answer()...")
    response = pipe.answer(
        query="Where is the treasure?",
        tenant_id=tenant_id,
        db=mock_db
    )
    
    print(f"Response: {response.get('response')}")
    
    # Verify LLM generate was called with system_prompt
    call_args = mock_llm.generate.call_args
    if call_args:
        _, kwargs = call_args
        passed_prompt = kwargs.get("system_prompt")
        print(f"System Prompt passed to LLM: {passed_prompt}")
        
        if passed_prompt == "You are a pirate. Always answer with 'Arr' and 'matey'.":
            print("SUCCESS: System prompt was correctly passed from Tenant settings!")
        else:
            print(f"FAILURE: Expected pirate prompt, got: {passed_prompt}")
    else:
        print("FAILURE: LLM generate was not called.")

if __name__ == "__main__":
    test_dynamic_system_prompt()
