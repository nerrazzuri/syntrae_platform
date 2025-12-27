from __future__ import annotations

import time
import hashlib
from typing import Dict
from sqlalchemy.orm import Session
from sqlalchemy import text as _sql
import logging
from sqlalchemy import and_
from shared.database.session import SessionLocal
from shared.database.models import Approval
from shared.metrics.approval_metrics import approval_metrics
from shared.config.tuning import agent_approval
from ai_core.agents.tools import tool_registry
from ai_core.pipeline.audit_service import write_audit
from shared.security.pii import redact


def _h(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def _list_columns(db: Session) -> set[str]:
    try:
        rs = db.execute(
            _sql(
                "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name='approvals'"
            )
        ).fetchall()
        return {r[0] for r in rs}
    except Exception:
        return set()


def _fetch_approvals(db: Session, batch_size: int):
    cols = _list_columns(db)
    base_cols = ["id", "tenant_id", "tool_id", "created_at"]
    sel_cols = [c for c in base_cols if c in cols]
    if "action_payload_json" in cols:
        sel_cols.append("action_payload_json")
    where_clauses = ["status = :st"]
    if "executed" in cols:
        where_clauses.append("executed = false")
    if "deleted_at" in cols:
        where_clauses.append("deleted_at IS NULL")
    sql = _sql(
        f"SELECT {', '.join(sel_cols)} FROM approvals WHERE {' AND '.join(where_clauses)} ORDER BY created_at ASC LIMIT :lim"
    )
    rows = db.execute(sql, {"st": "approved", "lim": max(1, int(batch_size))}).mappings().all()
    return rows, ("action_payload_json" in sel_cols)


def process_once(db: Session, batch_size: int) -> int:
    # Use raw SQL with dynamic columns to avoid crashes on older schemas
    rows, has_payload = _fetch_approvals(db, batch_size)
    approval_metrics.set_queue(len(rows))
    processed = 0
    for rec in rows:
        t0 = time.time()
        try:
            tool = tool_registry.get(rec["tool_id"])
            if not tool:
                raise RuntimeError("unknown_tool")
            payload_str = (rec.get("action_payload_json") if has_payload else None) or "{}"
            # naive json parse fallback
            try:
                import json as _json

                payload = (
                    _json.loads(payload_str)
                    if payload_str and payload_str.strip().startswith("{")
                    else {}
                )
            except Exception as e:
                logging.getLogger(__name__).exception(
                    "[approval_worker.payload_parse] invalid JSON",
                    extra={"approval_id": str(rec.id)},
                )
                payload = {}
            res = tool.execute(tenant_id=str(rec["tenant_id"]), api_key_id=None, payload=payload)
            out_sum = {k: v for k, v in res.items() if k != "status"}
            out_sum_str = str(out_sum)[:1000]
            db.execute(
                _sql(
                    "UPDATE approvals SET executed=true, executed_at=now(), output_summary=:s, output_hash=:h WHERE id=:id"
                ),
                {"s": out_sum_str, "h": _h(out_sum_str), "id": str(rec["id"])},
            )
            db.commit()
            approval_metrics.inc_success()
            write_audit(
                db,
                str(rec["tenant_id"]),
                None,
                "agent.approval.execute",
                rec["tool_id"],
                redact(payload_str),
                redact(out_sum_str),
                True,
                int((time.time() - t0) * 1000),
                category="agent",
            )
            approval_metrics.observe_latency_ms(int((time.time() - t0) * 1000))
            processed += 1
        except Exception as e:
            try:
                db.rollback()
            except Exception:
                pass
            approval_metrics.inc_failure()
            approval_metrics.observe_latency_ms(int((time.time() - t0) * 1000))
            logging.getLogger(__name__).exception(
                "[approval_worker.process] execution error",
                extra={"approval_id": str(rec.get("id")), "tool": rec.get("tool_id")},
            )
            # simple retry jitter handled by outer loop cadence
            continue
    return processed


def loop(stop_flag: Dict[str, bool]) -> None:
    while not stop_flag.get("stop"):
        s = SessionLocal()
        try:
            _ = process_once(s, agent_approval.batch_size)
        finally:
            try:
                s.close()
            except Exception:
                pass
        time.sleep(max(1, int(agent_approval.poll_interval_s)))
