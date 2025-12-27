from __future__ import annotations

from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone
import uuid
import re

from shared.database.models import ConversationMemory
from shared.config.tuning import memory as mem_cfg
from shared.metrics.memory_metrics import memory_metrics
from ai_core.pipeline.llm.llm_client import LLMClient


_PII_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_PII_PHONE = re.compile(r"\b(?:\+?\d[\s-]?){7,14}\b")
_PII_ID_GENERIC = re.compile(r"\b[A-Z0-9]{6,12}\b")
_PII_DOB_1 = re.compile(r"\b\d{2}/\d{2}/\d{4}\b")
_PII_DOB_2 = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")
_PII_ADDRESS = re.compile(
    r"\b(Street|St\.|Jalan|Blk|Avenue|Ave\.|Road|Rd\.)\b", re.IGNORECASE
)


def _redact_pii(text: str) -> str:
    s = text or ""
    s = _PII_EMAIL.sub("[REDACTED_EMAIL]", s)
    s = _PII_PHONE.sub("[REDACTED_PHONE]", s)
    if mem_cfg.pii_extended:
        s = _PII_DOB_1.sub("[REDACTED_DOB]", s)
        s = _PII_DOB_2.sub("[REDACTED_DOB]", s)
        # ID: avoid replacing obvious words; keep conservative
        s = _PII_ID_GENERIC.sub("[REDACTED_ID]", s)
        s = _PII_ADDRESS.sub("[REDACTED_ADDR]", s)
    return s


class MemoryService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self._llm = LLMClient()

    def append_turn(
        self, tenant_id: str, session_id: str, role: str, content: str
    ) -> None:
        now = datetime.now(timezone.utc)
        exp = now + timedelta(days=mem_cfg.ttl_days)
        safe = _redact_pii(content or "")
        rec = ConversationMemory(
            tenant_id=uuid.UUID(str(tenant_id)),
            session_id=uuid.UUID(str(session_id)),
            role=str(role),
            content=safe,
            created_at=now,
            expires_at=exp,
        )
        self.db.add(rec)
        self.db.commit()
        try:
            memory_metrics.inc_entries(tenant_id)
        except Exception:
            pass

    def _summarize(self, history_text: str) -> str:
        prompt = (
            "Summarize the prior conversation between the user and the assistant in concise bullet form.\n"
            "Keep facts, decisions, and unresolved questions.\n"
            "Do not repeat greetings or small talk.\n"
            "Use 3-7 bullets."
        )
        out = self._llm.generate(
            query=prompt, contexts=[history_text], intent="summary", result_hint=None
        )
        return out.get("text", "").strip()

    def update_summary(
        self, tenant_id: str, session_id: str, new_history_summary: str
    ) -> str:
        # fetch existing summary row if any
        existing = (
            self.db.query(ConversationMemory)
            .filter(ConversationMemory.tenant_id == uuid.UUID(str(tenant_id)))
            .filter(ConversationMemory.session_id == uuid.UUID(str(session_id)))
            .filter(ConversationMemory.summary.isnot(None))
            .order_by(ConversationMemory.created_at.desc())
            .first()
        )
        merged = new_history_summary
        if existing and existing.summary:
            combine_prompt = (
                "Combine the PRIOR SUMMARY with NEW EVENTS into a single concise bullet summary.\n"
                "Keep facts, decisions, and unresolved questions. Limit to 5-9 bullets."
            )
            out = self._llm.generate(
                query=combine_prompt,
                contexts=[existing.summary, new_history_summary],
                intent="summary",
                result_hint=None,
            )
            merged = out.get("text", "").strip() or new_history_summary
            # update existing
            existing.summary = merged
            existing.created_at = datetime.now(timezone.utc)
            existing.expires_at = existing.created_at + timedelta(days=mem_cfg.ttl_days)
            self.db.add(existing)
        else:
            now = datetime.now(timezone.utc)
            exp = now + timedelta(days=mem_cfg.ttl_days)
            sum_rec = ConversationMemory(
                tenant_id=uuid.UUID(str(tenant_id)),
                session_id=uuid.UUID(str(session_id)),
                role="assistant",
                content="",
                summary=new_history_summary,
                created_at=now,
                expires_at=exp,
            )
            self.db.add(sum_rec)
        self.db.commit()
        try:
            memory_metrics.inc_summary_update(tenant_id)
        except Exception:
            pass
        return merged

    def get_context(
        self, tenant_id: str, session_id: str, limit_recent: int = 5
    ) -> Dict[str, Any]:
        q = (
            self.db.query(ConversationMemory)
            .filter(ConversationMemory.tenant_id == uuid.UUID(str(tenant_id)))
            .filter(ConversationMemory.session_id == uuid.UUID(str(session_id)))
            .order_by(ConversationMemory.created_at.asc())
        )
        rows: List[ConversationMemory] = list(q.all())
        if not rows:
            return {"recent_turns": [], "summary": None}
        # Summarize if needed
        summary: Optional[str] = None
        if len(rows) > mem_cfg.summary_trigger_turns:
            older = rows[:-limit_recent]
            history_text = "\n".join([f"{r.role}: {r.content}" for r in older])
            try:
                summary = self._summarize(history_text)
                memory_metrics.inc_summary_ops(tenant_id)
                summary = self.update_summary(tenant_id, session_id, summary)
            except Exception:
                summary = None
        # Build recent list and enforce token budget
        recent = rows[-limit_recent:]
        recent_turns = [f"{r.role}: {r.content}" for r in recent]
        combo = ((summary or "") + "\n" + "\n".join(recent_turns)).strip()

        def _estimate_tokens(s: str) -> int:
            return len((s or "").split())

        pruned = 0
        while _estimate_tokens(combo) > mem_cfg.max_context_tokens and recent_turns:
            # prune according to strategy (currently only oldest makes sense on recent list)
            if mem_cfg.prune_strategy == "oldest":
                recent_turns = recent_turns[1:]
            else:
                recent_turns = recent_turns[1:]
            pruned += 1
            combo = ((summary or "") + "\n" + "\n".join(recent_turns)).strip()
        if pruned:
            try:
                memory_metrics.add_pruned(tenant_id, pruned)
            except Exception:
                pass
        return {"recent_turns": recent_turns, "summary": summary}
