from __future__ import annotations

import os
import json
import time
import re
import hashlib
from typing import Dict, Any, Tuple
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from prometheus_client import generate_latest  # type: ignore

from shared.config.tuning import compliance as compliance_cfg
from shared.database.models import AuditLog, RetentionPolicy, ComplianceReport
from shared.metrics.compliance_metrics import compliance_metrics


_RE_METRIC = re.compile(r"^(?P<name>[a-zA-Z_:][a-zA-Z0-9_:]*)\{?(?P<labels>[^}]*)\}?\s+(?P<value>[-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)$")


def _parse_labels(txt: str) -> Dict[str, str]:
    out: Dict[str, str] = {}
    if not txt:
        return out
    # labels like: system="postgres",tenant="..."
    for part in txt.split(","):
        part = part.strip()
        if not part:
            continue
        if "=" in part:
            k, v = part.split("=", 1)
            out[k.strip()] = v.strip().strip('"')
    return out


def _scrape_metrics() -> Dict[str, list[Tuple[Dict[str, str], float]]]:
    raw = generate_latest().decode("utf-8", errors="ignore")
    series: Dict[str, list[Tuple[Dict[str, str], float]]] = {}
    for line in raw.splitlines():
        if not line or line.startswith("#"):
            continue
        m = _RE_METRIC.match(line)
        if not m:
            continue
        name = m.group("name")
        labels = _parse_labels(m.group("labels") or "")
        try:
            val = float(m.group("value"))
        except Exception:
            continue
        series.setdefault(name, []).append((labels, val))
    return series


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


class ComplianceReporter:
    def __init__(self, out_dir: str | None = None) -> None:
        self.out_dir = out_dir or os.getenv("COMPLIANCE_OUT_DIR", "/tmp/ai_core_compliance")
        os.makedirs(self.out_dir, exist_ok=True)

    def _checksum(self, b: bytes) -> str:
        return hashlib.sha256(b).hexdigest()

    def _score_bool(self, ok: bool) -> float:
        return 1.0 if ok else 0.0

    def _collect_backup_freshness(self, series: Dict[str, list[Tuple[Dict[str, str], float]]]) -> Dict[str, Any]:
        # Use backup_last_success_unixtime per system; consider fresh if within threshold hours
        out: Dict[str, Any] = {"systems": {}, "all_fresh": True}
        now_unix = int(time.time())
        thr_s = compliance_cfg.threshold_backup_freshness_hours * 3600
        for labels, val in series.get("backup_last_success_unixtime", []):
            system = labels.get("system", "unknown")
            last = int(val)
            age = max(0, now_unix - last) if last > 0 else 1e12
            fresh = age <= thr_s
            out["systems"][system] = {"last_success_unix": last, "fresh": fresh, "age_seconds": age}
            if not fresh:
                out["all_fresh"] = False
        return out

    def _collect_restore(self, series: Dict[str, list[Tuple[Dict[str, str], float]]]) -> Dict[str, Any]:
        dur = int(series.get("restore_drill_duration_seconds", [( {}, 0 )])[-1][1] if series.get("restore_drill_duration_seconds") else 0)
        rto_ok = bool(int(series.get("restore_rto_compliance", [( {}, 0 )])[-1][1] if series.get("restore_rto_compliance") else 0))
        rpo_ok = bool(int(series.get("restore_rpo_compliance", [( {}, 0 )])[-1][1] if series.get("restore_rpo_compliance") else 0))
        # Apply threshold if gauge missing
        if not series.get("restore_rto_compliance"):
            rto_ok = dur <= compliance_cfg.threshold_rto_seconds
        return {"duration_seconds": dur, "rto_ok": rto_ok, "rpo_ok": rpo_ok}

    def _collect_retention(self, db: Session) -> Dict[str, Any]:
        # Lag from metrics gauge if present
        series = _scrape_metrics()
        lag_s = int(series.get("ai_core_retention_lag_seconds", [( {}, 0 )])[-1][1] if series.get("ai_core_retention_lag_seconds") else 0)
        thr = compliance_cfg.threshold_retention_lag_seconds
        ok = lag_s <= thr if lag_s > 0 else True
        # Also reflect policy freshness
        latest_enforced = None
        try:
            latest_enforced = (
                db.query(RetentionPolicy)
                .order_by(RetentionPolicy.last_enforced_at.desc())
                .first()
            )
        except Exception:
            pass
        if latest_enforced and latest_enforced.last_enforced_at:
            ts = latest_enforced.last_enforced_at
            try:
                from datetime import timezone as _tz

                if getattr(ts, "tzinfo", None) is None:
                    ts = ts.replace(tzinfo=_tz.utc)
            except Exception:
                pass
            try:
                age = (_now_utc() - ts).total_seconds()
                ok = ok and (age <= thr)
            except Exception:
                pass
        return {"lag_seconds": lag_s, "ok": bool(ok)}

    def _collect_vault(self, series: Dict[str, list[Tuple[Dict[str, str], float]]]) -> Dict[str, Any]:
        ttl = int(series.get("vault_token_ttl_seconds", [( {}, 0 )])[-1][1] if series.get("vault_token_ttl_seconds") else 0)
        thr_s = compliance_cfg.threshold_vault_rotation_days * 24 * 3600
        # If TTL is very low relative to threshold window, warn
        ok = ttl >= thr_s
        return {"token_ttl_seconds": ttl, "rotation_ok": bool(ok)}

    def _collect_audit_integrity(self, db: Session, period_days: int) -> Dict[str, Any]:
        start = _now_utc() - timedelta(days=period_days)
        total = 0
        ok_hash = 0
        try:
            rows = (
                db.query(AuditLog.request_hash, AuditLog.response_hash)
                .filter(AuditLog.created_at >= start)
                .all()
            )
            for req_h, res_h in rows:
                total += 1
                if (req_h or "") and (res_h or "") and len(str(req_h)) == 64 and len(str(res_h)) == 64:
                    ok_hash += 1
        except Exception:
            pass
        rate = (ok_hash / total) if total > 0 else 1.0
        return {"checked": total, "ok_hash": ok_hash, "integrity_rate": rate}

    def _collect_cost_security(self, series: Dict[str, list[Tuple[Dict[str, str], float]]]) -> Dict[str, Any]:
        # Best-effort aggregates
        total_cost = sum(v for _l, v in series.get("ai_core_cost_usd_total", [])) if series.get("ai_core_cost_usd_total") else 0.0
        critical_findings = int(os.getenv("CI_SECURITY_FINDINGS_CRITICAL", "0") or "0")
        return {"total_cost_usd": float(total_cost), "security_findings_critical": critical_findings}

    def _score(self, sections: Dict[str, Any]) -> Tuple[float, Dict[str, float]]:
        parts: Dict[str, float] = {}
        parts["backup_freshness"] = self._score_bool(sections.get("backup", {}).get("all_fresh", False))
        parts["restore_rto"] = self._score_bool(sections.get("restore", {}).get("rto_ok", False))
        parts["restore_rpo"] = self._score_bool(sections.get("restore", {}).get("rpo_ok", False))
        parts["retention"] = self._score_bool(sections.get("retention", {}).get("ok", False))
        parts["vault_rotation"] = self._score_bool(sections.get("vault", {}).get("rotation_ok", False))
        # Security gate: no critical findings => 1 else 0
        parts["security"] = self._score_bool((sections.get("cost_security", {}).get("security_findings_critical", 0) == 0))
        overall = sum(parts.values()) / max(1, len(parts))
        return overall, parts

    def generate_for_tenant(self, db: Session, tenant_id: str) -> Dict[str, Any]:
        series = _scrape_metrics()
        now = _now_utc()
        period_days = int(compliance_cfg.reporting_period_days)
        sections: Dict[str, Any] = {}
        sections["backup"] = self._collect_backup_freshness(series)
        sections["restore"] = self._collect_restore(series)
        sections["retention"] = self._collect_retention(db)
        sections["vault"] = self._collect_vault(series)
        sections["audit_integrity"] = self._collect_audit_integrity(db, period_days)
        sections["cost_security"] = self._collect_cost_security(series)

        overall, part_scores = self._score(sections)

        payload: Dict[str, Any] = {
            "generation_timestamp": now.isoformat().replace("+00:00", "Z"),
            "generator_version": "v1",
            "tenant_id": tenant_id,
            "reporting_period_days": period_days,
            "sections": sections,
            "scores": {"overall": overall, **part_scores},
        }
        blob = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        checksum = self._checksum(blob)
        # Write JSON artifact locally (S3 upload could be added if boto3 available)
        filename = f"compliance_summary_{tenant_id}_{int(time.time())}.json"
        out_path = os.path.join(self.out_dir, filename)
        with open(out_path, "wb") as f:
            f.write(blob)

        # Record DB metadata
        rec = ComplianceReport(
            tenant_id=tenant_id,
            artifact_path=f"file://{out_path}",
            artifact_checksum_sha256=checksum,
            status="generated",
            retention_days=365,
            generator_version="v1",
            period_start=now - timedelta(days=period_days),
            period_end=now,
            summary={
                "overall": overall,
                "noncompliant": overall < compliance_cfg.quality_gate_min_compliance,
            },
        )
        db.add(rec)
        db.commit()

        # Metrics
        try:
            compliance_metrics.mark_run(int(time.time()))
            noncomp = 1 if rec.summary.get("noncompliant") else 0
            compliance_metrics.set_noncompliant(noncomp)
        except Exception:
            pass

        return {"path": rec.artifact_path, "checksum": checksum, "summary": rec.summary, "scores": payload["scores"]}


