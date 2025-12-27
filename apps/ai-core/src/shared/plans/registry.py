from __future__ import annotations

from typing import Dict, Any


PLAN_COPY: Dict[str, str] = {
    "free": "Free: Chat with your data and connect public drives.",
    "pro": "Pro: Expand storage, connectors, and team access.",
    "enterprise": "Enterprise: Full integration, compliance, and dedicated environment.",
}

PLANS: Dict[str, Dict[str, Any]] = {
    "free": {
        "plan_name": "Free",
        "plan_label": "free",
        "description": PLAN_COPY["free"],
        "limits": {
            "max_docs": 10,
            "max_file_size": 5 * 1024 * 1024,
            "max_tokens_per_month": 200_000,
            "req_per_min": 10,
            "retention_days": 30,
        },
        "features": ["connectors", "analytics"],
        "connectors_allowed": ["google_drive", "onedrive"],
        "infra_policy": {
            "namespace_class": "omni-free",
            "hpa_limit": 1,
            "resource_quota": {"cpu": "250m", "memory": "512Mi"},
            "vault_path_class": "secret/free",
        },
        "metrics_label": "free",
    },
    "pro": {
        "plan_name": "Pro",
        "plan_label": "pro",
        "description": PLAN_COPY["pro"],
        "limits": {
            "max_docs": 1_000,
            "max_file_size": 50 * 1024 * 1024,
            "max_tokens_per_month": 5_000_000,
            "req_per_min": 60,
            "retention_days": 180,
        },
        "features": ["reranker", "multi_user", "api_access", "connectors", "analytics"],
        "connectors_allowed": ["google_drive", "onedrive", "dropbox"],
        "infra_policy": {
            "namespace_class": "omni-pro",
            "hpa_limit": 3,
            "resource_quota": {"cpu": "1", "memory": "2Gi"},
            "vault_path_class": "secret/pro",
        },
        "metrics_label": "pro",
    },
    "enterprise": {
        "plan_name": "Enterprise",
        "plan_label": "enterprise",
        "description": PLAN_COPY["enterprise"],
        "limits": {
            "max_docs": 10_000_000,
            "max_file_size": 500 * 1024 * 1024,
            "max_tokens_per_month": 1_000_000_000,
            "req_per_min": 1_000_000,
            "retention_days": 3650,
        },
        "features": ["reranker", "multi_user", "api_access", "connectors", "analytics"],
        "connectors_allowed": "*",
        "infra_policy": {
            "namespace_class": "tenant_dedicated",
            "hpa_limit": 0,
            "resource_quota": {},
            "vault_path_class": "secret/enterprise",
        },
        "metrics_label": "enterprise",
    },
}


def resolve_plan_label(subscription_tier: str | None) -> str:
    lab = (subscription_tier or "free").strip().lower()
    return lab if lab in PLANS else "free"


def get_plan(subscription_tier: str | None) -> Dict[str, Any]:
    label = resolve_plan_label(subscription_tier)
    return PLANS[label]


def list_plans() -> Dict[str, Dict[str, Any]]:
    return PLANS

def get_public_plan_copy(label: str) -> str:
    lab = resolve_plan_label(label)
    return PLAN_COPY.get(lab, PLAN_COPY["free"])


