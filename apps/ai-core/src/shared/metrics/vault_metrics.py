from prometheus_client import Counter


class _VaultMetrics:
    def __init__(self) -> None:
        self._fetch_total = Counter(
            "ai_core_vault_fetch_total", "Vault secret fetch attempts", ["result"]
        )  # result=success|failure|cache
        self._cache_hits_total = Counter(
            "ai_core_vault_cache_hits_total", "Vault client cache hits", []
        )
        self._failures_total = Counter(
            "ai_core_vault_failures_total", "Vault fetch failures", ["reason"]
        )  # reason=http|decode|auth|other
        self._rotations_total = Counter(
            "ai_core_vault_rotations_total", "Detected secret rotations", ["key"]
        )  # key hashed
        self._audit_events_total = Counter(
            "ai_core_vault_audit_events_total", "Vault fetch audit events", []
        )

    def inc_fetch_success(self) -> None:
        self._fetch_total.labels(result="success").inc()

    def inc_fetch_failure(self, reason: str) -> None:
        self._fetch_total.labels(result="failure").inc()
        self._failures_total.labels(reason=reason or "other").inc()

    def inc_cache_hit(self) -> None:
        self._fetch_total.labels(result="cache").inc()
        self._cache_hits_total.inc()

    def inc_rotation(self, key_hash: str) -> None:
        self._rotations_total.labels(key=key_hash).inc()

    def inc_audit_event(self) -> None:
        self._audit_events_total.inc()


vault_metrics = _VaultMetrics()
