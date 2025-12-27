"""
Error handling and circuit breaker patterns for external service integration.
"""
import asyncio
import time
from typing import Dict, Any, Callable, Optional
from enum import Enum
import logging
from functools import wraps

logger = logging.getLogger(__name__)


class CircuitBreakerState(Enum):
    """Circuit breaker states."""

    CLOSED = "closed"  # Normal operation
    OPEN = "open"  # Failing, requests blocked
    HALF_OPEN = "half_open"  # Testing if service recovered


class CircuitBreaker:
    """Circuit breaker implementation for external service calls."""

    def __init__(self, failure_threshold: int = 5, recovery_timeout: int = 60):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.failure_count = 0
        self.last_failure_time = None
        self.state = CircuitBreakerState.CLOSED

    def _should_attempt_reset(self) -> bool:
        """Check if enough time has passed to attempt a reset."""
        if self.last_failure_time is None:
            return True

        return (time.time() - self.last_failure_time) >= self.recovery_timeout

    def _reset(self):
        """Reset the circuit breaker to closed state."""
        self.failure_count = 0
        self.state = CircuitBreakerState.CLOSED
        logger.info("Circuit breaker reset to CLOSED state")

    def _record_failure(self):
        """Record a failure and potentially open the circuit."""
        self.failure_count += 1
        self.last_failure_time = time.time()

        if self.failure_count >= self.failure_threshold:
            self.state = CircuitBreakerState.OPEN
            logger.warning(
                f"Circuit breaker opened after {self.failure_count} failures"
            )

    def _record_success(self):
        """Record a success."""
        if self.state == CircuitBreakerState.HALF_OPEN:
            self._reset()
        elif self.state == CircuitBreakerState.CLOSED:
            self.failure_count = max(0, self.failure_count - 1)

    async def call(self, func: Callable, *args, **kwargs) -> Any:
        """Execute function with circuit breaker protection."""
        if self.state == CircuitBreakerState.OPEN:
            if self._should_attempt_reset():
                self.state = CircuitBreakerState.HALF_OPEN
                logger.info("Circuit breaker transitioning to HALF_OPEN for test call")
            else:
                raise Exception("Circuit breaker is OPEN - service unavailable")

        try:
            result = (
                await func(*args, **kwargs)
                if asyncio.iscoroutinefunction(func)
                else func(*args, **kwargs)
            )
            self._record_success()
            return result

        except Exception as e:
            self._record_failure()
            logger.error(f"Circuit breaker recorded failure: {e}")
            raise


class ErrorHandler:
    """Centralized error handling and response formatting."""

    @staticmethod
    def format_error_response(
        error_code: str,
        message: str,
        details: Optional[Dict[str, Any]] = None,
        status_code: int = 500,
    ) -> Dict[str, Any]:
        """Format standardized error response."""
        return {
            "error": {
                "code": error_code,
                "message": message,
                "details": details or {},
                "timestamp": time.time(),
            }
        }

    @staticmethod
    def handle_database_error(error: Exception) -> Dict[str, Any]:
        """Handle database-related errors."""
        logger.error(f"Database error: {error}")
        return ErrorHandler.format_error_response(
            "DATABASE_ERROR", "Database operation failed", status_code=500
        )

    @staticmethod
    def handle_external_service_error(
        service_name: str, error: Exception
    ) -> Dict[str, Any]:
        """Handle external service errors."""
        logger.error(f"External service error ({service_name}): {error}")
        return ErrorHandler.format_error_response(
            "EXTERNAL_SERVICE_ERROR",
            f"External service {service_name} is unavailable",
            status_code=503,
        )

    @staticmethod
    def handle_validation_error(
        field: str, value: Any, expected_format: str
    ) -> Dict[str, Any]:
        """Handle validation errors."""
        logger.warning(f"Validation error for field {field}: {value}")
        return ErrorHandler.format_error_response(
            "VALIDATION_ERROR",
            f"Invalid value for field {field}. Expected: {expected_format}",
            {"field": field, "value": str(value), "expected_format": expected_format},
            status_code=400,
        )

    @staticmethod
    def handle_authentication_error(reason: str) -> Dict[str, Any]:
        """Handle authentication errors."""
        logger.warning(f"Authentication error: {reason}")
        return ErrorHandler.format_error_response(
            "AUTHENTICATION_ERROR",
            "Authentication failed",
            {"reason": reason},
            status_code=401,
        )

    @staticmethod
    def handle_authorization_error(
        resource: str, required_permission: str
    ) -> Dict[str, Any]:
        """Handle authorization errors."""
        logger.warning(
            f"Authorization error for resource {resource}: missing {required_permission}"
        )
        return ErrorHandler.format_error_response(
            "AUTHORIZATION_ERROR",
            "Insufficient permissions",
            {"resource": resource, "required_permission": required_permission},
            status_code=403,
        )


class RetryPolicy:
    """Retry policy for external service calls."""

    def __init__(
        self, max_retries: int = 3, base_delay: float = 1.0, max_delay: float = 60.0
    ):
        self.max_retries = max_retries
        self.base_delay = base_delay
        self.max_delay = max_delay

    def get_delay(self, attempt: int) -> float:
        """Calculate delay for retry attempt using exponential backoff."""
        delay = self.base_delay * (2**attempt)
        return min(delay, self.max_delay)

    async def execute_with_retry(self, func: Callable, *args, **kwargs) -> Any:
        """Execute function with retry logic."""
        last_exception = None

        for attempt in range(self.max_retries + 1):
            try:
                return (
                    await func(*args, **kwargs)
                    if asyncio.iscoroutinefunction(func)
                    else func(*args, **kwargs)
                )

            except Exception as e:
                last_exception = e

                if attempt == self.max_retries:
                    logger.error(f"Max retries ({self.max_retries}) exceeded: {e}")
                    raise

                delay = self.get_delay(attempt)
                logger.warning(f"Retry attempt {attempt + 1} after {delay}s delay: {e}")
                await asyncio.sleep(delay)

        # Should never reach here, but just in case
        raise last_exception or Exception("Retry failed")


# Global instances
circuit_breaker = CircuitBreaker()
error_handler = ErrorHandler()
retry_policy = RetryPolicy()


def with_circuit_breaker(func: Callable) -> Callable:
    """Decorator to add circuit breaker protection to functions."""

    @wraps(func)
    async def wrapper(*args, **kwargs):
        return await circuit_breaker.call(func, *args, **kwargs)

    return wrapper


def with_retry(func: Callable) -> Callable:
    """Decorator to add retry logic to functions."""

    @wraps(func)
    async def wrapper(*args, **kwargs):
        return await retry_policy.execute_with_retry(func, *args, **kwargs)

    return wrapper
