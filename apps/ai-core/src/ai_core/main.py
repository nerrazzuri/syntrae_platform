"""
FastAPI application for AI Core - RAG-powered conversational AI service.
"""
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import logging
import os
from prometheus_client import (
    Counter,
    Histogram,
    generate_latest,
    CONTENT_TYPE_LATEST,
    REGISTRY,
)
from fastapi import Response
from ai_core.api.v1.query import router as query_router
from ai_core.api.webhooks.whatsapp import router as whatsapp_router
from ai_core.api.webhooks.teams import router as teams_router
from ai_core.api.webhooks.telegram import router as telegram_router
from ai_core.api.v1.internal import router as internal_router
from ai_core.api.v1.tenant_upload import router as tenant_router
from ai_core.api.v1.tenant.plan import router as tenant_plan_router
from ai_core.api.v1.tenant.usage import router as tenant_usage_router
from ai_core.api.v1.tenant.branding import router as tenant_branding_router
from .api.v1.reranker import router as reranker_router
from ai_core.api.v1.admin.api_keys import router as apikey_router
from ai_core.api.v1.admin.rerank import router as rerank_admin_router
from ai_core.api.v1.admin.features import router as features_admin_router
from ai_core.api.v1.admin.backup import router as backup_admin_router
from ai_core.api.v1.admin.restore import router as restore_admin_router
from ai_core.api.v1.admin.retention import router as retention_admin_router
from ai_core.api.v1.admin.compliance import router as compliance_admin_router
from ai_core.api.v1.admin.plans import router as plans_admin_router
from ai_core.api.v1.admin.connectors import router as connectors_admin_router
from ai_core.api.v1.admin.tenants import router as tenants_admin_router
from ai_core.api.v1.admin.tenant_manager import router as tenant_manager_router
from ai_core.api.v1.feedback import router as feedback_router
from ai_core.api.v1.agent.approvals import router as approvals_router
from ai_core.api.v1.agent.chat import router as agent_chat_router
from shared.database.session import create_tables, SessionLocal
from shared.database.models import Tenant
import uuid
import threading
import time

from shared.vector.qdrant import qdrant_service
from shared.queue.retry_queue import retry_queue
from ai_core.pipeline.embedding.embedding_service import EmbeddingService
from shared.config.tuning import qdrant_recovery
from shared.metrics.cost_aggregator import rolling_cost
from shared.config.tuning import cost as cost_cfg
from shared.config.tuning import connectors as connectors_cfg
from shared.metrics.stability_metrics import stability_metrics
from shared.utils.log_and_continue import log_and_continue
from shared.metrics.exception_metrics import exception_metrics
from shared.metrics.vault_rotation_metrics import vault_rotation_metrics
from shared.config.tuning import vault_rotation as vault_rot_cfg
from ai_core.orchestrator.orchestrator import Orchestrator
from ai_core.capabilities.search import SearchCapability
from ai_core.capabilities.answer import AnswerCapability
from ai_core.capabilities.extract import ExtractCapability
from ai_core.capabilities.score import ScoreCapability
from ai_core.capabilities.execute import ExecuteCapability
from ai_core.capabilities.observe import ObserveCapability
from ai_core.capabilities.govern import GovernCapability
from ai_core.capabilities.recommend import RecommendCapability
from ai_core.registry import CapabilityRegistry, CapabilitySpec

# Optional Sentry init
try:
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

    sentry_sdk.init(
        dsn=os.getenv("SENTRY_DSN"),
        integrations=[FastApiIntegration(), SqlalchemyIntegration()],
        environment=os.getenv("ENVIRONMENT", os.getenv("ENV", "staging")),
        traces_sample_rate=float(os.getenv("SENTRY_TRACES_RATE", "0.1")),
        send_default_pii=False,
    )
except Exception:
    pass


# Configure structured logging
class ColorFormatter(logging.Formatter):
    COLORS = {
        "DEBUG": "\x1b[36m",  # Cyan
        "INFO": "\x1b[32m",  # Green
        "WARNING": "\x1b[33m",  # Yellow
        "ERROR": "\x1b[31m",  # Red
        "CRITICAL": "\x1b[41m",  # Red background
    }
    RESET = "\x1b[0m"

    def format(self, record: logging.LogRecord) -> str:
        level_color = self.COLORS.get(record.levelname, "")
        msg = super().format(record)
        if level_color:
            return f"{level_color}{msg}{self.RESET}"
        return msg


handler = logging.StreamHandler()
handler.setLevel(logging.INFO)
handler.setFormatter(
    ColorFormatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
)

logger = logging.getLogger()
logger.setLevel(logging.INFO)
logger.handlers = [handler]
app_logger = logging.getLogger(__name__)

# Correlation ID middleware
from starlette.middleware.base import BaseHTTPMiddleware
import uuid as _uuid

# Load secrets from *_FILE env first, then initialize Vault secrets BEFORE importing auth middleware
try:
    from shared.security.secret_loader import load_file_env_secrets

    load_file_env_secrets()
except Exception:
    pass

try:
    from shared.config.tuning import vault as vault_cfg

    if vault_cfg.enabled:
        from shared.security.vault_client import vault_client

        # Load all under ai_core path and start background refresh
        loaded = vault_client.load_all()
        vault_client.start_refresh()
        # Map a few critical secrets into environment so early imports see them
        for key in (
            "JWT_SECRET",
            "OPENAI_API_KEY",
            "FILE_SIGNING_SECRET",
            "DB_PASSWORD",
            "QDRANT_API_KEY",
            "REDIS_PASSWORD",
            "ADMIN_UPLOAD_BEARER",
            "SENTRY_DSN",
        ):
            val = loaded.get(key) if isinstance(loaded, dict) else None
            if not val:
                # Try individual fetch
                val = vault_client.get_secret(key)
            if val:
                os.environ[key] = str(val)
            else:
                # In non-dev, fail fast if critical secret missing
                if os.getenv("ENV", "dev").lower() not in ("dev", "local", "test"):
                    raise RuntimeError(f"Missing required secret from Vault: {key}")
except Exception as _e:
    # If Vault enabled but fetch failed in prod, abort startup
    if os.getenv("ENV", "dev").lower() not in ("dev", "local", "test") and os.getenv(
        "VAULT_ENABLED", "false"
    ).lower() in ("1", "true", "yes"):
        raise
    app_logger = logging.getLogger(__name__)
    app_logger.warning(f"Vault initialization skipped/fallback: {_e}")

from ai_core.api.middleware.access import AccessControlMiddleware


class CorrelationIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        corr_id = request.headers.get("X-Correlation-ID") or str(_uuid.uuid4())
        # attach to request state
        request.state.correlation_id = corr_id
        # add to logs
        logging.LoggerAdapter(logger, {"correlation_id": corr_id})
        # add correlation id to sentry scope if available
        try:
            import sentry_sdk as _s

            with _s.configure_scope() as scope:
                scope.set_tag("correlation_id", corr_id)
        except Exception:
            pass
        response = await call_next(request)
        response.headers["X-Correlation-ID"] = corr_id
        return response


def _get_or_reuse_counter(name: str, help_text: str, labelnames=None) -> Counter:
    try:
        return Counter(name, help_text, labelnames or [])
    except ValueError as e:
        if "Duplicated timeseries" in str(e):
            try:
                existing = getattr(REGISTRY, "_names_to_collectors", {}).get(name)
                if isinstance(existing, Counter):
                    return existing  # type: ignore[return-value]
            except Exception:
                pass
        raise


def _get_or_reuse_histogram(name: str, help_text: str, labelnames=None) -> Histogram:
    try:
        return Histogram(name, help_text, labelnames or [])
    except ValueError as e:
        if "Duplicated timeseries" in str(e):
            try:
                existing = getattr(REGISTRY, "_names_to_collectors", {}).get(name)
                if isinstance(existing, Histogram):
                    return existing  # type: ignore[return-value]
            except Exception:
                pass
        raise


REQUEST_COUNT = _get_or_reuse_counter(
    "ai_core_requests_total", "Total HTTP requests", ["method", "endpoint", "status"]
)
REQUEST_LATENCY = _get_or_reuse_histogram(
    "ai_core_request_latency_seconds", "Request latency", ["endpoint"]
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan context manager."""
    app_logger.info("Starting AI Core service...")
    # Startup validations and uptime start
    global _START_TS
    _START_TS = __import__("time").time()
    try:
        _validate_startup()
    except Exception as e:
        app_logger.error(f"Startup validation failed: {e}")
        raise
    # Initialize schema: create tables in dev; Alembic upgrade in non-dev
    try:
        env = os.getenv("ENV", "dev").lower()
        if env in ("dev", "local", "test"):
            create_tables()
        else:
            try:
                from alembic.config import Config as _AlConfig
                from alembic import command as _alcmd
                import pathlib as _pl

                base = _pl.Path(__file__).resolve().parents[3]  # backend/
                
                # Dynamic discovery of alembic.ini to support Docker/Local path diffs
                here = _pl.Path(__file__).resolve()
                alembic_ini = None
                for parent in here.parents:
                    candidate = parent / "alembic.ini"
                    if candidate.exists():
                        alembic_ini = candidate
                        break

                if not alembic_ini:
                    # Fallback for some dev setups or log details
                    raise RuntimeError(f"alembic.ini not found in any parent of {here}")

                cfg = _AlConfig(str(alembic_ini))
                _alcmd.upgrade(cfg, "head")
            except Exception as _e:
                app_logger.error(f"Alembic upgrade failed: {_e}")
                raise
    except Exception as e:
        app_logger.warning(f"DB initialization skipped/failed: {e}")
    # Seed default tenant for development/staging to avoid FK violations
    try:
        default_tenant_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        db = SessionLocal()
        try:
            existing = db.get(Tenant, default_tenant_id)
            if not existing:
                tenant = Tenant(
                    id=default_tenant_id,
                    name="Global Tenant",
                    domain="global",
                    subscription_tier="BASIC",
                    settings={},
                )
                db.add(tenant)
                db.commit()
        finally:
            db.close()
    except Exception as e:
        app_logger.warning(f"Default tenant seeding failed or skipped: {e}")

    # Background: Qdrant health monitor and retry worker
    stop_flag = {"stop": False}

    def _qdrant_health_loop():
        app_logger.info(
            "qdrant health loop started",
            extra={"module_name": "qdrant_health", "pid": os.getpid()},
        )
        time.time()
        while not stop_flag["stop"]:
            try:
                ok = qdrant_service.ping()
                if ok:
                    time.time()
                else:
                    stability_metrics.inc_bg_failure("qdrant_health")
            except Exception as e:
                stability_metrics.inc_bg_failure("qdrant_health")
                stability_metrics.inc_bg_retry("qdrant_health")
                log_and_continue(e, "qdrant.health", None, None)
            time.sleep(max(0.1, qdrant_recovery.health_interval_ms / 1000.0))

    def _retry_worker_loop():
        app_logger.info(
            "retry worker loop started",
            extra={"module_name": "retry_worker", "pid": os.getpid()},
        )
        emb = EmbeddingService()
        while not stop_flag["stop"]:
            # process embedding jobs
            job = retry_queue.dequeue("embed_query", timeout=1)
            if job:
                try:
                    tenant_id = str(job.get("tenant_id") or "global")
                    payload = job.get("payload") or {}
                    q = str(payload.get("query") or "")
                    if q:
                        _ = emb.embed_query(q, tenant_id)
                except Exception as e:
                    stability_metrics.inc_bg_failure("retry_worker")
                    stability_metrics.inc_bg_retry("retry_worker")
                    log_and_continue(e, "retry_worker.embed", tenant_id, None)
                continue
            # process qdrant upsert jobs
            job2 = retry_queue.dequeue("qdrant_upsert", timeout=1)
            if job2:
                try:
                    tenant_id = str(job2.get("tenant_id") or "global")
                    payload = job2.get("payload") or {}
                    chunks = payload.get("chunks") or []
                    if chunks:
                        qdrant_service.upsert_knowledge_chunks(tenant_id, chunks)
                except Exception as e:
                    stability_metrics.inc_bg_failure("retry_worker")
                    stability_metrics.inc_bg_retry("retry_worker")
                    log_and_continue(e, "retry_worker.qdrant_upsert", tenant_id, None)
                continue
            # process audit logs
            job3 = retry_queue.dequeue("audit_log", timeout=1)
            if job3:
                try:
                    payload = job3.get("payload") or {}
                    tenant_id_raw = job3.get("tenant_id") or payload.get("tenant_id")
                    # Sanitize UUID fields to avoid DB binding errors
                    import uuid as _uuidmod

                    def _clean_uuid(val):
                        try:
                            if val is None:
                                return None
                            return str(_uuidmod.UUID(str(val)))
                        except Exception:
                            return None

                    tenant_id = (
                        _clean_uuid(tenant_id_raw)
                        or "00000000-0000-0000-0000-000000000001"
                    )
                    user_id = _clean_uuid(payload.get("user_id"))
                    api_key_id = _clean_uuid(payload.get("api_key_id"))
                    from shared.database.session import SessionLocal as _SL
                    from sqlalchemy import text as _sql

                    s = _SL()
                    try:
                        # Discover available columns for backward-compat inserts
                        cols = []
                        try:
                            rows = s.execute(
                                _sql(
                                    "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name='audit_log'"
                                )
                            ).fetchall()
                            cols = [r[0] for r in rows]
                            if not cols:
                                rows2 = s.execute(
                                    _sql(
                                        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='audit_log'"
                                    )
                                ).fetchall()
                                cols = [r[0] for r in rows2]
                        except Exception:
                            cols = []
                        now_id = str(_uuidmod.uuid4())
                        field_map = {
                            "id": now_id,
                            "tenant_id": tenant_id,
                            "user_id": user_id,
                            "api_key_id": api_key_id,
                            "correlation_id": payload.get("correlation_id"),
                            "auth_type": payload.get("auth_type"),
                            "category": payload.get("category"),
                            "action": payload.get("action"),
                            "resource": payload.get("resource"),
                            "classification": payload.get("classification"),
                            "origin": payload.get("origin"),
                            "request_hash": payload.get("request_hash"),
                            "response_hash": payload.get("response_hash"),
                            "success": bool(payload.get("success")),
                            "latency_ms": int(payload.get("latency_ms") or 0),
                            "model": payload.get("model"),
                            "token_input": payload.get("token_input"),
                            "token_output": payload.get("token_output"),
                            "extra": payload.get("extra") or {},
                        }
                        # Filter to existing columns only; if unknown, exclude optional fields like api_key_id
                        if cols:
                            insert_cols = [c for c in field_map.keys() if c in cols]
                        else:
                            insert_cols = [
                                c for c in field_map.keys() if c != "api_key_id"
                            ]
                        # Build parameterized INSERT
                        placeholders = []
                        params = {}
                        casts = {
                            "id": "::UUID",
                            "tenant_id": "::UUID",
                            "user_id": "::UUID",
                            "api_key_id": "::UUID",
                        }
                        for c in insert_cols:
                            key = f"p_{c}"
                            params[key] = field_map[c]
                            cast = casts.get(c, "")
                            # wrap bind in parentheses so SQLAlchemy recognizes it and Postgres cast applies cleanly
                            placeholders.append(f"(:{key}){cast}")
                        col_list = (
                            ", ".join(insert_cols + ["created_at"])
                            if ("created_at" not in insert_cols)
                            else ", ".join(insert_cols)
                        )
                        val_list = ", ".join(
                            placeholders
                            + (["now()"] if "created_at" not in insert_cols else [])
                        )
                        sql = _sql(
                            f"INSERT INTO audit_log ({col_list}) VALUES ({val_list})"
                        )
                        s.execute(sql, params)
                        s.commit()
                    finally:
                        s.close()
                except Exception as e:
                    stability_metrics.inc_bg_failure("retry_worker")
                    stability_metrics.inc_bg_retry("retry_worker")
                    log_and_continue(e, "retry_worker.audit_persist", tenant_id, None)
                continue
            # flush cost summaries periodically
            now = time.time()
            if int(now) % max(1, cost_cfg.persist_interval_s) == 0:
                try:
                    snap = rolling_cost.snapshot_and_clear()
                    if snap:
                        from shared.database.session import SessionLocal as _SL

                        s = _SL()
                        try:
                            from shared.database.models import CostSummary as _CS
                            import uuid as _uuidmod

                            def _clean_uuid(val):
                                try:
                                    return str(_uuidmod.UUID(str(val)))
                                except Exception:
                                    return None

                            for (tenant, model, kind), (tin, tout, usd) in snap.items():
                                cents = int(round(usd * 100.0))
                                tenant_uuid = (
                                    _clean_uuid(tenant)
                                    or "00000000-0000-0000-0000-000000000001"
                                )
                                rec = _CS(
                                    tenant_id=tenant_uuid,
                                    model=model,
                                    kind=kind,
                                    tokens_in=int(tin),
                                    tokens_out=int(tout),
                                    cost_usd=cents,
                                )
                                s.add(rec)
                            s.commit()
                        finally:
                            s.close()
                except Exception as e:
                    stability_metrics.inc_bg_failure("retry_worker")
                    log_and_continue(e, "retry_worker.cost_flush", None, None)

    def _memory_cleanup_loop():
        app_logger.info(
            "memory cleanup loop started",
            extra={"module_name": "memory_cleanup", "pid": os.getpid()},
        )
        from sqlalchemy import text as _sql
        from shared.metrics.memory_metrics import memory_metrics

        while not stop_flag["stop"]:
            try:
                # run every 5 minutes
                time.sleep(300)
                s = SessionLocal()
                try:
                    dialect = getattr(getattr(s, "bind", None), "dialect", None)
                    name = getattr(dialect, "name", "") if dialect else ""
                    if name == "sqlite":
                        # estimate count then delete (no RETURNING)
                        cnt = (
                            s.execute(
                                _sql(
                                    "SELECT COUNT(1) FROM conversation_memory WHERE expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP"
                                )
                            ).scalar()
                            or 0
                        )
                        s.execute(
                            _sql(
                                "DELETE FROM conversation_memory WHERE expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP"
                            )
                        )
                        s.commit()
                        try:
                            memory_metrics.add_cleanup_sqlite("global", int(cnt))
                        except Exception:
                            pass
                    else:
                        rows = s.execute(
                            _sql(
                                "DELETE FROM conversation_memory WHERE expires_at IS NOT NULL AND expires_at < now() RETURNING tenant_id"
                            )
                        ).fetchall()
                        s.commit()
                        # count by tenant
                        tenant_counts = {}
                        for r in rows:
                            tid = str(r[0])
                            tenant_counts[tid] = tenant_counts.get(tid, 0) + 1
                        for tid, c in tenant_counts.items():
                            memory_metrics.add_cleanup(tid, c)
                finally:
                    s.close()
            except Exception as e:
                stability_metrics.inc_bg_failure("memory_cleanup")
                log_and_continue(e, "memory.cleanup", None, None)

    t1 = threading.Thread(target=_qdrant_health_loop, daemon=True)
    t2 = threading.Thread(target=_retry_worker_loop, daemon=True)
    t3 = threading.Thread(target=_memory_cleanup_loop, daemon=True)

    # Approval worker
    def _approval_loop():
        try:
            from ai_core.agent.approval_worker import loop as _ap_loop

            _ap_loop(stop_flag)
        except Exception as e:
            stability_metrics.inc_bg_failure("approval_worker")
            log_and_continue(e, "agent.approval_worker", None, None)

    t4 = threading.Thread(target=_approval_loop, daemon=True)

    # Vault token renewal loop
    def _vault_renewal_loop():
        try:
            from shared.security.vault_client import vault_client as _vc

            failure_streak = 0
            paused = False
            while not stop_flag["stop"]:
                try:
                    ttl = _vc.lookup_token_ttl()
                    if ttl is not None:
                        vault_rotation_metrics.set_ttl(ttl)
                        if ttl < max(60, vault_rot_cfg.ttl_alert_threshold_s):
                            vault_rotation_metrics.inc_alert()
                            app_logger.warning(f"Vault token TTL low: {ttl}s")
                            if _vc.renew_token():
                                vault_rotation_metrics.inc_renew_ok()
                                failure_streak = 0
                                vault_rotation_metrics.set_failure_streak(
                                    failure_streak
                                )
                                if paused:
                                    vault_rotation_metrics.inc_resume()
                                    paused = False
                            else:
                                vault_rotation_metrics.inc_renew_fail()
                                failure_streak += 1
                                vault_rotation_metrics.set_failure_streak(
                                    failure_streak
                                )
                                # apply backoff with jitter
                                backoff = min(
                                    vault_rot_cfg.renew_backoff_max_s,
                                    vault_rot_cfg.renew_backoff_base_s
                                    * (2 ** min(6, failure_streak - 1)),
                                )
                                import random as _rand

                                sleep_s = backoff + _rand.uniform(
                                    0, vault_rot_cfg.renew_backoff_base_s
                                )
                                if not paused:
                                    vault_rotation_metrics.inc_pause()
                                    paused = True
                                app_logger.warning(
                                    f"Vault renew backoff: sleeping {int(sleep_s)}s (streak={failure_streak})"
                                )
                                # early exit check looped per second to honor stop_flag
                                for _ in range(int(sleep_s)):
                                    if stop_flag["stop"]:
                                        break
                                    time.sleep(1)
                        # verify secret access still works
                        if _vc.get_secret("JWT_SECRET") is not None:
                            vault_rotation_metrics.inc_verify_ok()
                        else:
                            vault_rotation_metrics.inc_verify_fail()
                except Exception as e:
                    log_and_continue(e, "vault.renewal", None, None)
                # normal cadence sleep with stop checks each second
                for _ in range(max(5, vault_rot_cfg.token_renew_interval_s)):
                    if stop_flag["stop"]:
                        break
                    time.sleep(1)
        except Exception as e:
            log_and_continue(e, "vault.renewal.init", None, None)

    t5 = threading.Thread(target=_vault_renewal_loop, daemon=True)

    # Retention worker
    def _retention_loop():
        try:
            from ai_core.retention_worker import loop as _rt_loop

            _rt_loop(stop_flag)
        except Exception as e:
            stability_metrics.inc_bg_failure("retention_worker")
            log_and_continue(e, "retention.worker", None, None)

    t6 = threading.Thread(target=_retention_loop, daemon=True)
    t1.start()
    t2.start()
    t3.start()
    t4.start()
    t5.start()
    t6.start()

    # Tenant migration worker
    def _migration_loop():
        try:
            from ai_core.migration_worker import loop as _mig_loop

            _mig_loop(stop_flag)
        except Exception as e:
            stability_metrics.inc_bg_failure("migration_worker")
            log_and_continue(e, "tenant.migration_worker", None, None)

    t8 = threading.Thread(target=_migration_loop, daemon=True)
    t8.start()

    # Compliance worker
    def _compliance_loop():
        try:
            from ai_core.compliance_worker import loop as _cp_loop

            _cp_loop(stop_flag)
        except Exception as e:
            stability_metrics.inc_bg_failure("compliance_worker")
            log_and_continue(e, "compliance.worker", None, None)

    t7 = threading.Thread(target=_compliance_loop, daemon=True)
    t7.start()

    # Start connector scheduler if enabled
    scheduler_thread = None
    if connectors_cfg.enabled and connectors_cfg.scheduler_enabled:
        try:
            # Discover tenants (for demo, include default only); extend to real tenant list in production
            tenants = ["00000000-0000-0000-0000-000000000001"]
            from ai_core.scheduler.scheduler import ConnectorScheduler

            sched = ConnectorScheduler(tenants)

            def _sched_loop():
                try:
                    sched.loop()
                except Exception as e:
                    stability_metrics.inc_bg_failure("scheduler")
                    log_and_continue(e, "connector.scheduler", None, None)

            scheduler_thread = threading.Thread(target=_sched_loop, daemon=True)
            scheduler_thread.start()
        except Exception:
            pass
    # Initialize capability singletons and orchestrator
    try:
        # Capability instances (stateless)
        from ai_core.capabilities.signal_inference import SignalInferenceCapability

        app.state.capabilities = {
            "search": SearchCapability(),
            "answer": AnswerCapability(),
            "extract": ExtractCapability(),
            "score": ScoreCapability(),
            "recommend": RecommendCapability(),
            "execute": ExecuteCapability(),
            "observe": ObserveCapability(),
            "govern": GovernCapability(),
            "signal_inference": SignalInferenceCapability(),
        }
        # Capability registry with metadata
        reg = CapabilityRegistry()
        # Common allowed channels
        allowed = {"web", "chat", "api", "webhook", "teams", "telegram", "whatsapp"}
        reg.register(
            CapabilitySpec(
                name="search",
                kind="search",
                inputs={"query"},
                outputs={"retrieved"},
                requires={"tenant_access"},
                forbids=set(),
                min_plan="free",
                allowed_channels=allowed,
                side_effects=False,
                description="Retrieve and fuse candidate contexts for a query.",
            )
        )
        reg.register(
            CapabilitySpec(
                name="answer",
                kind="answer",
                inputs={"query", "retrieved"},
                outputs={"response"},
                requires={"tenant_access"},
                forbids=set(),
                min_plan="free",
                allowed_channels=allowed,
                side_effects=False,
                description="Generate an answer from contexts and format response.",
            )
        )
        reg.register(
            CapabilitySpec(
                name="extract",
                kind="extract",
                inputs={"schema", "query"},
                outputs={"structured"},
                requires={"tenant_access"},
                forbids=set(),
                min_plan="free",
                allowed_channels=allowed,
                side_effects=False,
                description="Structured extraction for tabular/typed data.",
            )
        )
        reg.register(
            CapabilitySpec(
                name="score",
                kind="score",
                inputs={"retrieved", "query"},
                outputs={"reranked"},
                requires={"tenant_access"},
                forbids=set(),
                min_plan="free",
                allowed_channels=allowed,
                side_effects=False,
                description="Rerank retrieved contexts with cross-encoder and heuristics.",
            )
        )
        reg.register(
            CapabilitySpec(
                name="recommend",
                kind="recommend",
                inputs={"candidates"},
                outputs={"items"},
                requires={"tenant_access"},
                forbids=set(),
                min_plan="free",
                allowed_channels={"chat", "api"},
                side_effects=False,
                description="Lightweight recommendation over existing ranked/raw candidates (diversity, suppression, top-K).",
            )
        )
        reg.register(
            CapabilitySpec(
                name="execute",
                kind="execute",
                inputs={"goal", "query"},
                outputs={"actions"},
                requires={"tool_execution"},
                forbids=set(),
                min_plan="pro",
                allowed_channels={"web", "chat", "api"},  # webhook blocked by default
                side_effects=True,
                description="Execute agent tools and workflows (may have side effects).",
            )
        )
        reg.register(
            CapabilitySpec(
                name="observe",
                kind="observe",
                inputs=set(),
                outputs=set(),
                requires=set(),
                forbids=set(),
                min_plan="free",
                allowed_channels=allowed,
                side_effects=False,
                description="Feedback/evaluation/audit observation hooks.",
            )
        )
        reg.register(
            CapabilitySpec(
                name="signal_inference",
                kind="signal_inference",
                inputs={"text"},
                outputs={"inferred_signals"},
                requires=set(),  # No specific permissions strictly required for internal use, but good to have
                forbids=set(),
                min_plan="free",
                allowed_channels={"api", "internal"},
                side_effects=False,
                description="Infer cognitive signals from text (internal use).",
            )
        )
        reg.register(
            CapabilitySpec(
                name="govern",
                kind="govern",
                inputs={"text"},
                outputs={"text"},
                requires=set(),
                forbids=set(),
                min_plan="free",
                allowed_channels=allowed,
                side_effects=False,
                description="Policy and redaction pre/post enforcement.",
            )
        )
        app.state.capability_registry = reg
        app.state.orchestrator = Orchestrator(app.state.capabilities, reg)
        app_logger.info("Initialized orchestrator and capabilities")
    except Exception as _cap_e:
        app_logger.error(f"Capability/orchestrator init failed: {_cap_e}")
    yield
    app_logger.info("Shutting down AI Core service...")
    # Cleanup logic here
    stop_flag["stop"] = True
    try:
        t5.join(timeout=5)
        app_logger.info("Vault renewal loop stopped gracefully")
    except Exception:
        pass


# Startup model validation & uptime
_START_TS = None


def _validate_startup() -> None:
    # JWT secret check is handled in jwt service, but warn here too if weak
    try:
        sec = os.getenv("JWT_SECRET", "")
        if sec and len(sec) < 32:
            app_logger.warning("JWT_SECRET seems weak (<32 chars).")
    except Exception:
        pass
    # Model validation
    model = os.getenv("LLM_MODEL") or os.getenv("RAG_CHAT_MODEL", "gpt-4o-mini")
    if not model:
        raise RuntimeError("LLM_MODEL environment variable must be set.")


# Create FastAPI application
app = FastAPI(
    title="Omnichannel RAG Chatbot - AI Core",
    description="Enterprise-grade RAG-powered conversational AI service",
    version="1.0.0",
    lifespan=lifespan,
)

# Add CORS middleware (restricted by default unless DEV)
DEV = os.getenv("ENV", "dev").lower() in ("dev", "local", "test")
allow_origins = (
    ["*"] if DEV else [o for o in (os.getenv("ALLOW_ORIGINS", "").split(",")) if o]
)
if not allow_origins:
    allow_origins = ["http://localhost:3000"] if DEV else []
if not DEV and ("*" in allow_origins):
    app_logger.warning("Wildcard CORS in non-dev environment.")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add correlation ID middleware
app.add_middleware(CorrelationIdMiddleware)
app.add_middleware(AccessControlMiddleware)


# Global exception handler to ensure JSON responses
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    try:
        exception_metrics.inc()
        import sentry_sdk as _s

        _s.capture_exception(exc)
    except Exception:
        pass
    return JSONResponse(
        status_code=500, content={"detail": f"Internal server error: {str(exc)}"}
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.get("/v1/health")
async def health_check():
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    uptime = 0
    try:
        if _START_TS:
            uptime = int((now.timestamp() - _START_TS))
    except Exception:
        uptime = 0
    return {
        "status": "ok",
        "time_utc": now.isoformat().replace("+00:00", "Z"),
        "uptime_seconds": uptime,
    }


@app.get("/v1/ready")
async def ready_check():
    from shared.cache.redis import redis_cache
    from shared.database.session import engine
    from sqlalchemy import text as _sql_text

    ok_db = False
    ok_redis = False
    try:
        with engine.connect() as conn:
            conn.execute(_sql_text("SELECT 1"))
            ok_db = True
    except Exception:
        ok_db = False
    try:
        ok_redis = bool(redis_cache.ping())
    except Exception:
        ok_redis = False
    return {
        "status": "ok" if (ok_db and ok_redis) else "degraded",
        "db": ok_db,
        "redis": ok_redis,
    }


@app.get("/metrics")
async def metrics():
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


app.include_router(query_router)
app.include_router(whatsapp_router)
app.include_router(internal_router)
app.include_router(teams_router)
app.include_router(telegram_router)
app.include_router(tenant_router)
app.include_router(tenant_plan_router)
app.include_router(tenant_usage_router)
app.include_router(tenant_branding_router)
app.include_router(reranker_router)
app.include_router(apikey_router)
app.include_router(rerank_admin_router)
app.include_router(feedback_router)
app.include_router(approvals_router)
app.include_router(agent_chat_router)
app.include_router(backup_admin_router)
app.include_router(restore_admin_router)
app.include_router(retention_admin_router)
app.include_router(features_admin_router)
app.include_router(compliance_admin_router)
app.include_router(tenants_admin_router)
app.include_router(plans_admin_router)
app.include_router(connectors_admin_router)
app.include_router(tenant_manager_router)

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True, log_level="info")
