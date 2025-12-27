from prometheus_client import Counter, Histogram


tenant_create_total = Counter("tenant_create_total", "Tenant create actions")
tenant_activate_total = Counter("tenant_activate_total", "Tenant activate actions")
tenant_upgrade_total = Counter(
    "tenant_upgrade_total", "Tenant upgrade actions", ["from", "to"]
)
tenant_downgrade_total = Counter(
    "tenant_downgrade_total", "Tenant downgrade actions", ["from", "to"]
)
tenant_suspend_total = Counter("tenant_suspend_total", "Tenant suspend actions")
tenant_migration_failures_total = Counter(
    "tenant_migration_failures_total", "Tenant migration failures", ["stage", "reason"]
)
tenant_migration_duration_seconds = Histogram(
    "tenant_migration_duration_seconds", "Migration duration seconds", ["type"]
)

tenant_overlimit_resources = Counter(
    "tenant_overlimit_resources", "Over-limit resources", ["tenant_id", "type"]
)


