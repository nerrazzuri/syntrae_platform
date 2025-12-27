from prometheus_client import Counter


ai_core_requests_total = Counter(
    "ai_core_requests_total", "AI-Core requests", ["plan_type", "endpoint"]
)

def inc_request(plan_type: str, endpoint: str) -> None:
    try:
        ai_core_requests_total.labels(plan_type=plan_type or "unknown", endpoint=endpoint).inc()
    except Exception:
        pass


