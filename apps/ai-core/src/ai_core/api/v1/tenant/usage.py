from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from datetime import datetime, timezone
from calendar import monthrange

from shared.database.session import get_db
from shared.database.models import Tenant, Document, KnowledgeBase, CostSummary
from shared.plans.registry import get_plan, resolve_plan_label
from ai_core.api.deps import require

router = APIRouter(prefix="/v1/tenant", tags=["tenant-usage"])


@router.get("/usage")
def get_usage(db: Session = Depends(get_db), claims=Depends(require("retrieval:read"))):
    tenant_id = str(claims.get("tenant_id") or "")
    t = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    plan_label = resolve_plan_label(getattr(t, "subscription_tier", None))
    plan = get_plan(plan_label)

    # tokens used current month
    now = datetime.now(timezone.utc)
    start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
    tokens_in = 0
    tokens_out = 0
    try:
        row = (
            db.query(
                (CostSummary.tokens_in),
                (CostSummary.tokens_out),
            )
            .filter(CostSummary.tenant_id == tenant_id, CostSummary.window_start >= start)
            .all()
        )
        for r in row:
            tokens_in += int(r[0] or 0)
            tokens_out += int(r[1] or 0)
    except Exception:
        pass
    tokens_used = tokens_in + tokens_out

    # docs count
    docs_count = 0
    try:
        q = (
            db.query(Document)
            .join(KnowledgeBase, Document.knowledge_base_id == KnowledgeBase.id)
            .filter(KnowledgeBase.tenant_id == tenant_id)
        )
        docs_count = q.count()
    except Exception:
        docs_count = 0

    limits = plan.get("limits", {})
    return {
        "plan_type": plan_label,
        "tokens_used": int(tokens_used),
        "tokens_quota": int(limits.get("max_tokens_per_month") or 0),
        "docs_count": int(docs_count),
        "docs_quota": int(limits.get("max_docs") or 0),
        "req_per_min": int(limits.get("req_per_min") or 0),
    }


