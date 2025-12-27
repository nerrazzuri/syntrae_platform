import time
from shared.utils.retry import retry_with_backoff
from shared.utils.circuit_breaker import circuit_breaker


def test_retry_succeeds_on_second_attempt():
    calls = {"n": 0}

    @retry_with_backoff("unit.test", max_attempts=3, base_delay_ms=1, jitter_ms=0)
    def flaky():
        calls["n"] += 1
        if calls["n"] < 2:
            raise RuntimeError("boom")
        return 42

    assert flaky() == 42
    assert calls["n"] == 2


def test_circuit_breaker_open_and_close():
    svc = "svc"
    tenant = "t1"
    # induce failures
    for _ in range(6):
        circuit_breaker.record_failure(svc, tenant)
    assert circuit_breaker.state(svc, tenant) == circuit_breaker.OPEN
    # cooldown
    time.sleep(0.02)
    # allow probe
    assert circuit_breaker.allow(svc, tenant) is True
    # success closes
    circuit_breaker.record_success(svc, tenant)
    assert circuit_breaker.state(svc, tenant) == circuit_breaker.CLOSED
