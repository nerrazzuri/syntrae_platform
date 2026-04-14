from ai_core.pipeline.llm.prompt_orchestrator import PromptOrchestrator


def test_prompt_budget_trims_context_without_truncating_prompt_structure():
    orchestrator = PromptOrchestrator()
    orchestrator.max_prompt_tokens = 220
    orchestrator.prompt_output_headroom = 40

    context_docs = [
        {
            "id": "S1",
            "source_label": "Doc One",
            "text": "Alpha " * 200,
        },
        {
            "id": "S2",
            "source_label": "Doc Two",
            "text": "Beta " * 200,
        },
    ]

    prompt = orchestrator.build_prompt(
        intent="lookup",
        query="What should I know?",
        context_docs=context_docs,
    )

    assert "QUESTION:\nWhat should I know?" in prompt
    assert "When you state a fact from a snippet" in prompt
    assert orchestrator._estimate_tokens(prompt) <= orchestrator._context_budget_tokens()
    assert "S1:" in prompt
    assert "Sources:" in prompt
    assert "S1 → Doc One" in prompt
    assert prompt.count("QUESTION:") == 1


def test_prompt_budget_only_lists_sources_for_kept_snippets():
    orchestrator = PromptOrchestrator()
    orchestrator.max_prompt_tokens = 160
    orchestrator.prompt_output_headroom = 40

    prompt = orchestrator.build_prompt(
        intent="lookup",
        query="Need answer",
        context_docs=[
            {"id": "S1", "source_label": "Doc One", "text": "Alpha " * 120},
            {"id": "S2", "source_label": "Doc Two", "text": "Beta " * 120},
        ],
    )

    has_s2_text = "S2:" in prompt
    has_s2_source = "S2 → Doc Two" in prompt
    assert has_s2_text == has_s2_source
