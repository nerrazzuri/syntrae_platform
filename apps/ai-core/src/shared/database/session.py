"""
Database session configuration for SQLAlchemy with robust connection handling.

Behavior:
- Uses DATABASE_URL from environment, defaults to SQLite file for development.
- Retries connection to the configured database on startup.
- If a non-SQLite database is unreachable after retries, falls back to SQLite
  to ensure the app starts without noisy warnings.
"""
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import StaticPool
from .models import Base
import os
import time
import logging
from shared.config.tuning import db_pool
from contextvars import ContextVar

logger = logging.getLogger(__name__)

# Database URL from environment
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./test.db")
_TENANT_CTX: ContextVar[str | None] = ContextVar("_TENANT_CTX", default=None)


def set_tenant_context(tenant_id: str | None) -> None:
    """Set per-request tenant context for DB (used by RLS: app.tenant_id)."""
    try:
        _TENANT_CTX.set(str(tenant_id) if tenant_id else None)
    except Exception:
        pass


def _create_engine_for_url(url: str):
    """Create a SQLAlchemy engine appropriate for the given URL."""
    if url.startswith("sqlite"):
        return create_engine(
            url,
            poolclass=StaticPool,
            connect_args={"check_same_thread": False},
            echo=db_pool.echo,
        )
    # Non-SQLite: use default pooling and pre_ping
    return create_engine(
        url,
        echo=db_pool.echo,
        pool_pre_ping=True,
        pool_size=db_pool.pool_size,
        max_overflow=db_pool.max_overflow,
        pool_recycle=db_pool.pool_recycle,
        pool_timeout=db_pool.pool_timeout,
    )


def _try_connect(test_engine, attempts: int = 10, delay_seconds: float = 1.0) -> bool:
    """Try to connect to the database a few times to allow container warmup."""
    for i in range(1, attempts + 1):
        try:
            with test_engine.connect() as conn:
                conn.execute(text("SELECT 1"))
                return True
        except Exception as e:
            if i == attempts:
                break
            time.sleep(delay_seconds)
    return False


# Create primary engine; retry; environment-aware fallback
engine = _create_engine_for_url(DATABASE_URL)
if not DATABASE_URL.startswith("sqlite"):
    if not _try_connect(engine):
        env = os.getenv("ENV", "dev").lower()
        if env in ("dev", "local", "test"):
            logger.warning(
                f"Primary DB unreachable at {DATABASE_URL}. Falling back to SQLite (./test.db) for development."
            )
            DATABASE_URL = "sqlite:///./test.db"
            engine = _create_engine_for_url(DATABASE_URL)
            _try_connect(engine, attempts=1)
        else:
            raise RuntimeError(
                f"Database unreachable at {DATABASE_URL} in {env} environment. Failing fast."
            )

# Create session factory
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _ensure_sqlite_migrations() -> None:
    """Minimal migration shim for SQLite to keep local dev DB in sync.

    Adds missing columns introduced after initial creation without destroying data.
    """
    if not DATABASE_URL.startswith("sqlite"):
        return
    # Allow disabling dev shim via env flag
    if os.getenv("ENABLE_SQLITE_DEV_SHIM", "true").lower() not in {"1", "true", "yes"}:
        return
    try:
        with engine.connect() as conn:
            # Check conversations table exists
            result = conn.execute(
                text(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'"
                )
            )
            if result.fetchone() is None:
                return
            # Inspect columns
            cols = conn.execute(text("PRAGMA table_info(conversations)")).fetchall()
            col_names = {row[1] for row in cols}
            if "channel_context" not in col_names:
                conn.execute(
                    text("ALTER TABLE conversations ADD COLUMN channel_context JSON")
                )
    except Exception:
        # Do not block app start on shim failure
        pass


_initialized = False


def get_db() -> Session:
    """Get database session."""
    global _initialized, engine, SessionLocal  # noqa: PLW0603
    if not _initialized:
        try:
            _ensure_sqlite_migrations()
            Base.metadata.create_all(bind=engine)
        finally:
            _initialized = True
    db = SessionLocal()
    try:
        # Proactive ping to avoid stale connections in long-lived pools
        try:
            db.execute(text("SELECT 1"))
        except Exception:
            # Attempt to recreate engine and session on failure
            try:
                engine.dispose()
            except Exception:
                pass
            engine = _create_engine_for_url(DATABASE_URL)
            SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
            db.close()
            db = SessionLocal()
        # Set per-request tenant for PostgreSQL RLS (SET LOCAL app.tenant_id = ...)
        try:
            if not DATABASE_URL.startswith("sqlite"):
                tid = _TENANT_CTX.get()
                if tid:
                    db.execute(text("SET LOCAL app.tenant_id = :tid"), {"tid": tid})
        except Exception:
            pass
        yield db
    finally:
        db.close()


def create_tables():
    """Create all tables."""
    Base.metadata.create_all(bind=engine)


def drop_tables():
    """Drop all tables."""
    Base.metadata.drop_all(bind=engine)
