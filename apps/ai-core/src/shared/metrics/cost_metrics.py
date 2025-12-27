from __future__ import annotations


try:
    from prometheus_client import Counter, Histogram  # type: ignore
except Exception:  # pragma: no cover
    Counter = None  # type: ignore
    Histogram = None  # type: ignore

from shared.config.tuning import telemetry


class CostMetrics:
    def __init__(self) -> None:
        if telemetry.enable_metrics and Counter is not None:
            self.tokens_in = Counter(
                "ai_core_tokens_input_total",
                "Prompt tokens",
                ["tenant", "model", "kind"],
            )
            self.tokens_out = Counter(
                "ai_core_tokens_output_total", "Completion tokens", ["tenant", "model"]
            )
            self.cost_usd = Counter(
                "ai_core_cost_usd_total",
                "Accumulated cost (USD)",
                ["tenant", "model", "kind"],
            )
            self.cache_hits = Counter(
                "ai_core_cache_hits_total", "Cache hits", ["tenant", "scope"]
            )
            self.cache_miss = Counter(
                "ai_core_cache_miss_total", "Cache misses", ["tenant", "scope"]
            )
        else:
            self.tokens_in = None
            self.tokens_out = None
            self.cost_usd = None
            self.cache_hits = None
            self.cache_miss = None

    def record_tokens(
        self,
        tenant: str,
        model: str,
        kind: str,
        prompt_tokens: int,
        completion_tokens: int,
        usd: float,
    ) -> None:
        try:
            if self.tokens_in is not None and prompt_tokens:
                self.tokens_in.labels(tenant=tenant, model=model, kind=kind).inc(
                    max(0, int(prompt_tokens))
                )
            if self.tokens_out is not None and completion_tokens:
                self.tokens_out.labels(tenant=tenant, model=model).inc(
                    max(0, int(completion_tokens))
                )
            if self.cost_usd is not None and usd:
                self.cost_usd.labels(tenant=tenant, model=model, kind=kind).inc(
                    max(0.0, float(usd))
                )
        except Exception:
            pass

    def hit(self, tenant: str, scope: str) -> None:
        try:
            if self.cache_hits is not None:
                self.cache_hits.labels(tenant=tenant, scope=scope).inc()
        except Exception:
            pass

    def miss(self, tenant: str, scope: str) -> None:
        try:
            if self.cache_miss is not None:
                self.cache_miss.labels(tenant=tenant, scope=scope).inc()
        except Exception:
            pass


cost_metrics = CostMetrics()
