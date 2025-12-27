"""
FastAPI application for Gateway - Multi-channel webhook and authentication layer.
Restored with functional rate limiting, structured logging, and settings integration.
"""
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from datetime import datetime
import logging
import time
import os
from typing import Callable, Tuple
from functools import wraps

from backend.src.shared.config.settings import settings


class RateLimitExceeded(Exception):
    """Raised when a client exceeds the configured request rate."""


class SimpleRateLimiter:
    """In-memory sliding window rate limiter."""

    def __init__(self):
        self.requests = {}

    @staticmethod
    def _parse_rule(rule: str) -> Tuple[int, int]:
        count_str, window_str = rule.split("/")
        count = int(count_str)
        window_str = window_str.lower()
        if window_str in ("s", "sec", "second", "seconds"):
            window = 1
        elif window_str in ("m", "min", "minute", "minutes"):
            window = 60
        elif window_str in ("h", "hr", "hour", "hours"):
            window = 60 * 60
        else:
            window = 60
        return count, window

    def is_allowed(self, key: str, rule: str) -> bool:
        limit, window = self._parse_rule(rule)
        now = time.time()
        bucket = self.requests.setdefault(key, [])
        # Evict old entries
        cutoff = now - window
        i = 0
        for i, t in enumerate(bucket):
            if t >= cutoff:
                break
        if bucket and bucket[0] < cutoff:
            # Trim old timestamps
            while bucket and bucket[0] < cutoff:
                bucket.pop(0)
        if len(bucket) >= limit:
            return False
        bucket.append(now)
        return True


def rate_limited(rule: str) -> Callable:
    """Decorator to apply rate limiting to endpoints."""

    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(*args, **kwargs):
            request: Request = None
            # Find Request in args/kwargs
            for arg in args:
                if isinstance(arg, Request):
                    request = arg
                    break
            if request is None:
                request = kwargs.get("request")

            client_ip = request.client.host if request and request.client else "unknown"
            path = request.url.path if request else func.__name__
            key = f"{client_ip}:{path}"
            if not app.state.limiter.is_allowed(key, rule):
                raise RateLimitExceeded()
            return await func(*args, **kwargs)

        return wrapper

    return decorator


# Configure logging
logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Omnichannel RAG Chatbot - Gateway",
    description="Multi-channel webhook and authentication gateway",
    version="1.0.0",
    docs_url="/docs" if settings.debug else None,
    redoc_url="/redoc" if settings.debug else None,
)

app.state.limiter = SimpleRateLimiter()
app.state.metrics = {"requests_total": 0, "errors_total": 0, "start_time": time.time()}


@app.exception_handler(RateLimitExceeded)
async def handle_rate_limit_exceeded(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={
            "detail": "Rate limit exceeded",
            "path": request.url.path,
            "timestamp": datetime.utcnow().isoformat(),
        },
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.debug else [],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=["*"]
    if settings.debug
    else ["api.company.com", "gateway.company.com"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.time()
    app.state.metrics["requests_total"] += 1
    try:
        response = await call_next(request)
        duration = time.time() - start
        logger.info(
            f"{request.method} {request.url.path} -> {response.status_code} in {duration:.3f}s"
        )
        return response
    except Exception as e:
        app.state.metrics["errors_total"] += 1
        duration = time.time() - start
        logger.error(
            f"{request.method} {request.url.path} error: {e} in {duration:.3f}s"
        )
        raise


@app.get("/health")
@rate_limited("100/minute")
async def health_check(request: Request):
    return {
        "status": "healthy",
        "service": "gateway",
        "version": "1.0.0",
        "timestamp": datetime.utcnow().isoformat(),
    }


@app.get("/metrics")
@rate_limited("10/minute")
async def metrics(request: Request):
    uptime = time.time() - app.state.metrics["start_time"]
    return {
        "service": "gateway",
        "uptime_seconds": int(uptime),
        "requests_total": app.state.metrics["requests_total"],
        "errors_total": app.state.metrics["errors_total"],
    }


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", 3001))
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=settings.debug,
        log_level=settings.log_level.lower(),
    )
