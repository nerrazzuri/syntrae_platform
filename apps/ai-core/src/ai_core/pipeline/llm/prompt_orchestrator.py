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
        self.max_prompt_tokens = int(os.getenv("RAG_PROMPT_MAX_TOKENS", "8000"))
        self.prompt_output_headroom = int(
            os.getenv("RAG_PROMPT_OUTPUT_HEADROOM_TOKENS", "1200")
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

    def _truncate_text(self, text: str, max_chars: int) -> str:
        if max_chars <= 0:
            return ""
        if len(text) <= max_chars:
            return text
        clipped = text[:max_chars].rstrip()
        cut_candidates = [
            clipped.rfind("\n"),
            clipped.rfind(" "),
            clipped.rfind("。"),
            clipped.rfind("."),
            clipped.rfind("，"),
            clipped.rfind(","),
        ]
        cut_at = max(cut_candidates)
        if cut_at > max_chars // 2:
            clipped = clipped[:cut_at].rstrip()
        return clipped + " ..."

    def _context_entries(
        self, context_docs: List[Any]
    ) -> tuple[List[Dict[str, str]], str]:
        entries: List[Dict[str, str]] = []
        sources_block = ""
        if context_docs and isinstance(context_docs[0], dict):
            sources: List[str] = []
            for item in context_docs:  # type: ignore
                sid = str(item.get("id", "")).strip() or f"S{len(entries)+1}"
                txt = str(item.get("text", "")).strip()
                src = str(item.get("source_label", sid))
                if not txt:
                    continue
                entries.append({"id": sid, "text": txt})
                sources.append(f"{sid} → {src}")
            if sources:
                sources_block = "\nSources:\n" + "\n".join(sources) + "\n"
        else:
            for c in context_docs:
                if isinstance(c, str) and c.strip():
                    entries.append({"id": "", "text": c.strip()})
        return entries, sources_block

    def _render_context(
        self, entries: List[Dict[str, str]], sources_block: str = ""
    ) -> str:
        ctx_lines = [
            f"{entry['id']}: {entry['text']}" if entry.get("id") else entry["text"]
            for entry in entries
            if entry.get("text")
        ]
        ctx = "\n\n".join(ctx_lines)
        if sources_block:
            return ctx + ("\n\n" if ctx else "") + sources_block
        return ctx

    def _context_budget_tokens(self) -> int:
        return max(512, self.max_prompt_tokens - self.prompt_output_headroom)

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

        ctx_entries, sources_block = self._context_entries(context_docs)
        ctx = self._render_context(ctx_entries, sources_block)
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
        prompt_tpl = (
            tpl
            + "\nWhen you state a fact from a snippet, append its ID in square brackets (e.g., [S1]). "
            "You may attach multiple IDs for synthesized statements (e.g., [S2][S3]). Do not invent IDs."
        )
        prompt = prompt_tpl.format(
            structured_block=structured_block, context=ctx, question=query
        )
        # Ensure guard phrase exists
        if "Answer based only on provided context" not in prompt:
            prompt = "Answer based only on provided context.\n\n" + prompt

        # Token capping: trim low-priority context entries instead of corrupting prompt structure.
        tokens = self._estimate_tokens(prompt)
        prompt_budget = self._context_budget_tokens()
        if tokens > prompt_budget and ctx_entries:
            kept_entries: List[Dict[str, str]] = []
            kept_sources: List[str] = []
            source_lines = (
                [line for line in sources_block.strip().splitlines()[1:] if line.strip()]
                if sources_block
                else []
            )

            for idx, entry in enumerate(ctx_entries):
                candidate_entries = kept_entries + [entry]
                candidate_sources = kept_sources + (
                    [source_lines[idx]] if idx < len(source_lines) else []
                )
                candidate_sources_block = (
                    "\nSources:\n" + "\n".join(candidate_sources) + "\n"
                    if candidate_sources
                    else ""
                )
                candidate_ctx = self._render_context(
                    candidate_entries, candidate_sources_block
                )
                candidate_prompt = prompt_tpl.format(
                    structured_block=structured_block,
                    context=candidate_ctx,
                    question=query,
                )
                if self._estimate_tokens(candidate_prompt) <= prompt_budget:
                    kept_entries = candidate_entries
                    kept_sources = candidate_sources
                    continue

                if not kept_entries:
                    base_prompt = prompt_tpl.format(
                        structured_block=structured_block, context="", question=query
                    )
                    available_chars = max(
                        200,
                        (prompt_budget - self._estimate_tokens(base_prompt)) * 4,
                    )
                    truncated_entry = dict(entry)
                    truncated_entry["text"] = self._truncate_text(
                        entry["text"], available_chars
                    )
                    kept_entries = [truncated_entry]
                    kept_sources = candidate_sources
                break

            trimmed_sources_block = (
                "\nSources:\n" + "\n".join(kept_sources) + "\n" if kept_sources else ""
            )
            ctx = self._render_context(kept_entries, trimmed_sources_block)
            prompt = prompt_tpl.format(
                structured_block=structured_block, context=ctx, question=query
            )
            tokens = self._estimate_tokens(prompt)

        self._log_metrics(
            intent,
            self._template_key(intent),
            len(ctx_entries),
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
