from __future__ import annotations

from typing import Dict, Any, List
from sqlalchemy.orm import Session

from shared.database.models import FeedbackEvent


class FeedbackService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def add_event(
        self,
        tenant_id: str,
        user_id: str | None,
        query: str,
        predicted_intent: str | None,
        final_response: str | None,
        label: str,
        meta: Dict[str, Any] | None = None,
    ) -> str:
        # De-dup simple: same tenant+query+label within last N minutes could be dropped; keep simple now
        rec = FeedbackEvent(
            tenant_id=tenant_id,
            user_id=user_id,
            query=query,
            predicted_intent=predicted_intent,
            final_response=final_response,
            label=label,
            meta=meta or {},
        )
        self.db.add(rec)
        self.db.commit()
        self.db.refresh(rec)
        return str(rec.id)

    def list_events(self, tenant_id: str, limit: int = 100) -> List[Dict[str, Any]]:
        items = (
            self.db.query(FeedbackEvent)
            .filter(FeedbackEvent.tenant_id == tenant_id)
            .order_by(FeedbackEvent.created_at.desc())
            .limit(limit)
            .all()
        )
        out: List[Dict[str, Any]] = []
        for it in items:
            out.append(
                {
                    "id": str(it.id),
                    "label": it.label,
                    "query": it.query[:500],
                    "predicted_intent": it.predicted_intent,
                    "created_at": str(it.created_at),
                }
            )
        return out
