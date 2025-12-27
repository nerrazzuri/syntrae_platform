from __future__ import annotations

from sqlalchemy import inspect
from shared.database.session import engine, create_tables


def test_critical_tables_columns_exist():
    create_tables()
    insp = inspect(engine)
    must_tables = [
        "audit_log",
        "api_keys",
        "feedback_events",
        "eval_runs",
        "tenant_rerank_config",
        "cost_summaries",
    ]
    for t in must_tables:
        assert insp.has_table(t), f"missing table {t}"
