from typing import Dict, Any, List
import re

from ai_core.pipeline.llm.llm_client import LLMClient
from shared.utils.text_normalize import normalize_multiline_text


class ResponseFormatter:
    def __init__(self) -> None:
        self._llm = LLMClient()

    def generate(
        self,
        query: str,
        contexts: List[Any],
        intent: str = "lookup",
        result_hint: str | None = None,
        tenant_id: str | None = None,
    ) -> Dict[str, Any]:
        """Use the same prompt and LLM call style as rag_service to assemble final payload.

        For now, delegate to rag_service prompt template and OpenAI client to keep parity.
        """
        if not contexts:
            return {
                "response": "I don’t have that information in the current database.",
                "citations": [],
                "confidence": 0.0,
                "requiresHuman": True,
            }
        # Normalize contexts to dict snippets {id, source_label, text, doc?}
        norm_ctx: List[Dict[str, Any]] = []
        for i, c in enumerate(contexts):
            if isinstance(c, dict):
                norm_ctx.append(c)
            else:
                norm_ctx.append(
                    {"id": f"S{i+1}", "source_label": f"Context {i+1}", "text": str(c)}
                )
        gen = self._llm.generate(
            query, norm_ctx, intent=intent, result_hint=result_hint, tenant_id=tenant_id
        )
        # Fallback preview uses first snippet text
        first_text = str(norm_ctx[0].get("text", "")) if norm_ctx else ""
        generated_text = (gen.get("text") or "").strip() or (
            first_text[:300] if first_text else ""
        )
        # Normalize multi-line formatting and preserve newlines for frontend rendering
        generated_text = normalize_multiline_text(generated_text)

        # Ensure list formatting: if multiple non-empty lines without bullets/numbers, add bullets
        def _ensure_list_formatting(txt: str) -> str:
            lines = txt.split("\n")
            # consider only non-empty lines
            content_lines = [ln for ln in lines if ln.strip()]
            if len(content_lines) < 2:
                return txt
            bullet_re = re.compile(r"^(\s*)([-*•]|\d+\.)\s+")
            changed = False
            new_lines: List[str] = []
            for ln in lines:
                if not ln.strip():
                    new_lines.append(ln)
                    continue
                if bullet_re.match(ln):
                    new_lines.append(ln)
                    continue
                # Prefix a dash bullet for plain lines
                new_lines.append(f"- {ln.strip()}")
                changed = True
            return "\n".join(new_lines) if changed else txt

        generated_text = _ensure_list_formatting(generated_text)
        # Parse [S#] tokens from model output and map to provenance
        id_to_ctx = {
            str(s.get("id")): s for s in norm_ctx if isinstance(s, dict) and s.get("id")
        }
        found_ids = [m.group(1) for m in re.finditer(r"\[(S\d+)\]", generated_text)]
        citations: List[Dict[str, Any]] = []
        seen: set[str] = set()
        for sid in found_ids:
            if sid in seen:
                continue
            seen.add(sid)
            snip = id_to_ctx.get(sid)
            if not snip:
                continue
            doc = snip.get("doc") or {}
            citations.append(
                {
                    "source": doc.get("source_url") or doc.get("id") or sid,
                    "title": doc.get("title") or snip.get("source_label") or sid,
                    "relevance": snip.get("score") or snip.get("relevance") or 0.0,
                    "snippet": (snip.get("text") or "")[:400],
                }
            )
        # If none found, include up to first 3 snippets as best-effort
        if not citations:
            for s in norm_ctx[:3]:
                doc = s.get("doc") or {}
                citations.append(
                    {
                        "source": doc.get("source_url") or doc.get("id") or s.get("id"),
                        "title": doc.get("title") or s.get("source_label"),
                        "relevance": s.get("score") or s.get("relevance") or 0.0,
                        "snippet": (s.get("text") or "")[:400],
                    }
                )
        payload = {
            "response": generated_text,
            "final_response": generated_text,
            "citations": citations,
            "confidence": 0.0,
            "requiresHuman": False if contexts else True,
        }
        # Post-generation QC: if response is overly similar to raw context, reduce duplication by hinting stricter summary next pass (one retry)
        try:
            import difflib

            joined = "\n".join(contexts[:3])
            ratio = difflib.SequenceMatcher(
                a=generated_text.lower(), b=joined.lower()
            ).ratio()
            if ratio > 0.9 and intent in ("summary", "lookup"):
                gen2 = self._llm.generate(
                    query,
                    norm_ctx,
                    intent="summary",
                    result_hint=result_hint,
                    tenant_id=tenant_id,
                )
                txt2 = (gen2.get("text") or "").strip()
                if txt2 and len(txt2) < len(generated_text):
                    payload["response"] = txt2
        except Exception:
            pass
        return payload
