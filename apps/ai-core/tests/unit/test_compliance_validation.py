import os


def test_compliance_report_handles_missing_metrics(monkeypatch):
    os.environ["ENV"] = "test"
    from ai_core.services.compliance_reporter import ComplianceReporter
    from shared.database.session import create_tables, SessionLocal

    create_tables()

    db = SessionLocal()
    try:
        rep = ComplianceReporter()
        out = rep.generate_for_tenant(db, "00000000-0000-0000-0000-000000000001")
        assert "summary" in out and "scores" in out
        assert "overall" in out["summary"]
    finally:
        db.close()


