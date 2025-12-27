"""
Structured logging utilities with correlation IDs and audit trails.
"""
import logging
import logging.config
import uuid
from typing import Dict, Any, Optional
from datetime import datetime
import structlog


# Configure structlog for structured logging
def configure_structured_logging(log_level: str = "INFO") -> None:
    """Configure structlog for structured JSON logging."""

    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            structlog.stdlib.add_logger_name,
            structlog.stdlib.add_log_level,
            structlog.stdlib.PositionalArgumentsFormatter(),
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.UnicodeDecoder(),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        logger_factory=structlog.stdlib.LoggerFactory(),
        context_class=dict,
        cache_logger_on_first_use=True,
    )

    # Configure the root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, log_level.upper()))

    # Remove existing handlers
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)

    # Add JSON handler
    handler = logging.StreamHandler()
    handler.setFormatter(
        structlog.stdlib.ProcessorFormatter(
            processor=structlog.processors.JSONRenderer(),
            foreign_pre_chain=[
                structlog.stdlib.filter_by_level,
                structlog.stdlib.add_logger_name,
                structlog.stdlib.add_log_level,
            ],
        )
    )
    root_logger.addHandler(handler)


class StructuredLogger:
    """Structured logger with correlation IDs and audit trails."""

    def __init__(self, name: str = "app"):
        self.logger = structlog.get_logger(name)

    def _log_with_context(
        self,
        level: str,
        message: str,
        correlation_id: Optional[str] = None,
        user_id: Optional[str] = None,
        tenant_id: Optional[str] = None,
        **kwargs,
    ):
        """Log with structured context."""
        context = {
            "correlation_id": correlation_id or str(uuid.uuid4()),
            "timestamp": datetime.utcnow().isoformat(),
        }

        if user_id:
            context["user_id"] = user_id
        if tenant_id:
            context["tenant_id"] = tenant_id

        context.update(kwargs)

        log_method = getattr(self.logger, level.lower())
        log_method(message, **context)

    def info(self, message: str, **kwargs):
        """Log info level message."""
        self._log_with_context("info", message, **kwargs)

    def warning(self, message: str, **kwargs):
        """Log warning level message."""
        self._log_with_context("warning", message, **kwargs)

    def error(self, message: str, **kwargs):
        """Log error level message."""
        self._log_with_context("error", message, **kwargs)

    def debug(self, message: str, **kwargs):
        """Log debug level message."""
        self._log_with_context("debug", message, **kwargs)

    def log_conversation_event(
        self,
        event_type: str,
        conversation_id: str,
        user_id: str,
        tenant_id: str,
        metadata: Optional[Dict[str, Any]] = None,
    ):
        """Log conversation-related events."""
        self.info(
            f"Conversation event: {event_type}",
            event_type=event_type,
            conversation_id=conversation_id,
            user_id=user_id,
            tenant_id=tenant_id,
            metadata=metadata or {},
        )

    def log_rag_query(
        self,
        query: str,
        response_confidence: float,
        context_docs_count: int,
        tenant_id: str,
        user_id: Optional[str] = None,
    ):
        """Log RAG query events."""
        self.info(
            "RAG query processed",
            query_length=len(query),
            response_confidence=response_confidence,
            context_docs_count=context_docs_count,
            tenant_id=tenant_id,
            user_id=user_id,
        )

    def log_authentication_event(
        self,
        event_type: str,
        user_id: str,
        tenant_id: str,
        success: bool,
        method: str = "unknown",
    ):
        """Log authentication events."""
        self.info(
            f"Authentication event: {event_type}",
            event_type=event_type,
            user_id=user_id,
            tenant_id=tenant_id,
            success=success,
            auth_method=method,
        )


# Global logger instance
logger = StructuredLogger()

# Initialize structured logging
configure_structured_logging()
