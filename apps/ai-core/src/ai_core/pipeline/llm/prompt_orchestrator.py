from __future__ import annotations

from typing import List, Optional, Dict, Any
import os


class PromptOrchestrator:
    def __init__(self) -> None:
        self.verbosity = os.getenv("RAG_PROMPT_VERBOSITY", "normal").lower()
        self.include_sources = os.getenv("INCLUDE_SOURCE_TAGS", "true").lower() in (
            "1",
            "true",
            "yes",
        )
        self._templates: Dict[str, str] = self._build_templates()

    def _build_templates(self) -> Dict[str, str]:
        cite_line = (
            "Include brief source markers if available." if self.include_sources else ""
        )
        preface = (
            "Answer based only on provided context. Do not hallucinate. " + cite_line
        )
        formatting = (
            "\nWhen your answer includes multiple items, steps, or recommendations, format them as a numbered or bullet-point list.\n"
            "Each point must start on a new line and be clearly separated.\n"
            "Example:\n1. Step one\n2. Step two\n3. Step three\n\n"
        )
        base = (
            "You are Omni, a precise enterprise assistant.\n"
            + preface
            + formatting
            + "\n\n{structured_block}---\nCONTEXT:\n{context}\n---\nQUESTION:\n{question}\n---\n"
        )
        t_lookup = base + "Provide a short, direct answer first."
        t_summary = base + "Write an executive summary in 3-6 bullet points."
        t_compare = (
            base
            + "Provide a structured bullet comparison (A vs B) with 3-5 key differences and similarities."
        )
        t_aggregate = (
            base
            + "Explain the computed values succinctly, then add 1-2 lines of analysis."
        )
        t_explain = base + "Explain clearly and concisely, then add a 2-3 bullet recap."
        t_creative = (
            base
            + "Provide a brief creative response that remains grounded in the context."
        )
        return {
            "lookup": t_lookup,
            "summary": t_summary,
            "compare": t_compare,
            "aggregate": t_aggregate,
            "explanatory": t_explain,
            "creative": t_creative,
        }

    def _estimate_tokens(self, text: str) -> int:
        # crude estimate: 1 token ~ 4 chars
        return int(len(text) / 4)

    def build_prompt(
        self,
        intent: str,
        query: str,
        context_docs: List[str],
        result_hint: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> str:
        tpl = self._templates.get(intent, self._templates["lookup"])  # default
        # Apply verbosity adjustments
        if self.verbosity == "terse":
            tpl = tpl.replace("3-6 bullet points", "3 bullet points").replace(
                "3-5 key differences", "3 key differences"
            )
        elif self.verbosity == "verbose":
            tpl = tpl.replace("3-6 bullet points", "4-8 bullet points").replace(
                "1-2 lines of analysis", "2-4 lines of analysis"
            )

        # Structured result block
        structured_block = ""
        if result_hint:
            structured_block = f"Structured Result Summary:\n{result_hint}\n\n"

        # Context handling with snippet IDs: if provided as dicts, format with IDs and build Sources legend
        ctx_lines: List[str] = []
        sources: List[str] = []
        if context_docs and isinstance(context_docs[0], dict):
            for item in context_docs:  # type: ignore
                sid = str(item.get("id", "")).strip() or f"S{len(ctx_lines)+1}"
                txt = str(item.get("text", "")).strip()
                src = str(item.get("source_label", sid))
                if not txt:
                    continue
                ctx_lines.append(f"{sid}: {txt}")
                sources.append(f"{sid} → {src}")
            if sources:
                sources_block = "\nSources:\n" + "\n".join(sources) + "\n"
            else:
                sources_block = ""
        else:
            # Fallback: plain texts
            ctx_lines = [
                c.strip() for c in context_docs if isinstance(c, str) and c.strip()
            ]
            sources_block = ""
        ctx = "\n\n".join(ctx_lines) + ("\n\n" + sources_block if sources_block else "")
        if not ctx and not result_hint:
            # Controlled fallback meta-prompt
            meta = (
                "You are Omni. No usable context was provided. "
                "Acknowledge the lack of context and avoid speculation. "
                "If appropriate, suggest the user provide more specific documents or data.\n\n"
                f"QUESTION:\n{query}\n---\n"
                "Respond briefly."
            )
            self._log_metrics(intent, "fallback", 0, 0, bool(result_hint))
            return meta

        # Add citation instruction to all prompts
        tpl += "\nWhen you state a fact from a snippet, append its ID in square brackets (e.g., [S1]). You may attach multiple IDs for synthesized statements (e.g., [S2][S3]). Do not invent IDs."
        prompt = tpl.format(
            structured_block=structured_block, context=ctx, question=query
        )
        # Ensure guard phrase exists
        if "Answer based only on provided context" not in prompt:
            prompt = "Answer based only on provided context.\n\n" + prompt

        # Token capping
        tokens = self._estimate_tokens(prompt)
        if tokens > 8000:
            # Reduce context size by truncation
            max_chars = 8000 * 4
            prompt = prompt[:max_chars]
            tokens = self._estimate_tokens(prompt)

        self._log_metrics(
            intent,
            self._template_key(intent),
            len(context_docs),
            tokens,
            bool(result_hint),
        )
        return prompt

    def _template_key(self, intent: str) -> str:
        return intent if intent in self._templates else "lookup"

    def _log_metrics(
        self,
        intent: str,
        template: str,
        context_len: int,
        token_estimate: int,
        has_result_hint: bool,
    ) -> None:
        try:
            from shared.logging.pipeline_logger import PipelineLogger

            # tenant_id not known here; logger will use a generic file if needed
            PipelineLogger("global").emit(
                {
                    "prompt_orchestrator": {
                        "intent": intent,
                        "template": template,
                        "context_len": context_len,
                        "token_estimate": token_estimate,
                        "has_result_hint": has_result_hint,
                    }
                }
            )
        except Exception:
            pass
