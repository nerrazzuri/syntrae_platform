from __future__ import annotations

import random
import time
from typing import Callable, Any, Optional
import logging

from shared.config.tuning import retries

logger = logging.getLogger(__name__)


def _sleep_ms(ms: int) -> None:
    time.sleep(max(0.0, ms) / 1000.0)


def retry_with_backoff(
    operation: str,
    max_attempts: Optional[int] = None,
    base_delay_ms: Optional[int] = None,
    max_delay_ms: Optional[int] = None,
    jitter_ms: Optional[int] = None,
    on_fail: Optional[Callable[[Exception], None]] = None,
) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """Decorator factory to retry a callable with exponential backoff and jitter.

    - operation: logical name for logging/metrics (e.g., 'openai.embed', 'qdrant.upsert')
    - on_fail: optional callback invoked after final failure
    """

    ma = retries.max_attempts if max_attempts is None else int(max_attempts)
    bd = retries.base_delay_ms if base_delay_ms is None else int(base_delay_ms)
    md = retries.max_delay_ms if max_delay_ms is None else int(max_delay_ms)
    jt = retries.jitter_ms if jitter_ms is None else int(jitter_ms)

    def _decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
        def _wrapped(*args, **kwargs):
            attempt = 0
            last_exc: Optional[Exception] = None
            delay = bd
            while attempt < ma:
                try:
                    return fn(*args, **kwargs)
                except Exception as e:  # noqa: BLE001
                    last_exc = e
                    attempt += 1
                    if attempt >= ma:
                        break
                    # jittered delay
                    jitter = random.randint(0, max(0, jt))
                    _delay = min(md, delay + jitter)
                    try:
                        logger.warning(
                            f"retry({operation}): attempt={attempt}/{ma} sleeping_ms={_delay} error={e}"
                        )
                    except Exception:
                        pass
                    _sleep_ms(_delay)
                    delay = min(md, max(bd, delay * 2))
            if on_fail:
                try:
                    on_fail(last_exc or Exception("retry_failed"))
                except Exception:
                    pass
            if last_exc:
                raise last_exc
            return None

        return _wrapped

    return _decorator
