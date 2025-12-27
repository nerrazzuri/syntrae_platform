from __future__ import annotations

try:
    from prometheus_client import Counter
except Exception:  # pragma: no cover
    class _Dummy:
        def labels(self, *args, **kwargs):  # type: ignore
            return self

        def inc(self, *args, **kwargs):  # type: ignore
            return None

    def Counter(*args, **kwargs):  # type: ignore
        return _Dummy()


cross_tenant_blocked = Counter(
    "security_cross_tenant_blocked_total",
    "Requests blocked due to cross-tenant access attempts",
    ["route"],
)

invalid_signature_total = Counter(
    "security_invalid_signature_total",
    "Count of invalid/expired signed URL accesses",
    ["route"],
)


