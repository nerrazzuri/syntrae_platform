"""
Centralized tuning knobs for chunking and retrieval.

Adjust values here to control behavior without touching multiple files.
"""
from dataclasses import dataclass
import os


def _get_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except Exception:
        return default


def _get_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except Exception:
        return default


@dataclass(frozen=True)
class ChunkingConfig:
    # Mode: 'tokens' (preferred) or 'chars'
    mode: str = os.getenv("CHUNK_MODE", "tokens").lower()
    # Token-based targets (used when mode == 'tokens')
    target_tokens: int = _get_int("CHUNK_TARGET_TOKENS", 800)
    overlap_tokens: int = _get_int("CHUNK_OVERLAP_TOKENS", 120)
    min_tokens: int = _get_int("CHUNK_MIN_TOKENS", 120)
    # Approximate character target per chunk (used when tokenization isn’t available)
    target_chars: int = _get_int("CHUNK_TARGET_CHARS", 1400)
    # Number of sentence overlap between chunks
    sentence_overlap: int = _get_int("CHUNK_SENTENCE_OVERLAP", 2)
    # Minimum characters to accept; otherwise merge with neighbors
    min_chars: int = _get_int("CHUNK_MIN_CHARS", 300)


@dataclass(frozen=True)
class RetrievalConfig:
    # Max contexts from hybrid retrieval before augmentation
    hybrid_top_k: int = _get_int("RETR_HYBRID_TOP_K", 12)
    # Vector augmentation hits
    vector_top_k: int = _get_int("RETR_VECTOR_TOP_K", 8)
    # Field-value vector hits
    field_value_top_k: int = _get_int("RETR_FIELD_VALUE_TOP_K", 8)
    # Reranker cap and output size
    rerank_input_cap: int = _get_int("RETR_RERANK_INPUT_CAP", 30)
    rerank_top_k: int = _get_int("RETR_RERANK_TOP_K", 12)
    # Iterative expansion tries
    expand_variants: int = _get_int("RETR_EXPAND_VARIANTS", 4)
    # Expansion cache TTL (seconds)
    expand_cache_ttl: int = _get_int("RETR_EXPAND_CACHE_TTL", 1800)
    # Enable/disable rule-based handlers (prefer AI-only when false)
    rules_enabled: bool = os.getenv("RETR_RULES_ENABLED", "false").lower() in (
        "1",
        "true",
        "yes",
    )
    # Hybrid retrieval and weights
    hybrid_enabled: bool = os.getenv("RETR_HYBRID_ENABLED", "true").lower() in (
        "1",
        "true",
        "yes",
    )
    expansion_enabled: bool = os.getenv("RETR_EXPANSION_ENABLED", "true").lower() in (
        "1",
        "true",
        "yes",
    )
    hybrid_weight_vector: float = _get_float("RETR_HYBRID_WEIGHT_VECTOR", 0.7)
    hybrid_weight_bm25: float = _get_float("RETR_HYBRID_WEIGHT_BM25", 0.3)
    # Schema expansion normalization/capping
    schema_expansion_top_k: int = _get_int("RETR_SCHEMA_EXP_TOP_K", 3)
    schema_expansion_min_weight: float = _get_float("RETR_SCHEMA_EXP_MIN_W", 0.08)
    schema_expansion_hint_max_chars: int = _get_int(
        "RETR_SCHEMA_EXP_HINT_MAX_CHARS", 120
    )
    # Enable/disable individual retrievers
    hybrid_use_bm25: bool = os.getenv("RETR_USE_BM25", "true").lower() in (
        "1",
        "true",
        "yes",
    )
    hybrid_use_dense: bool = os.getenv("RETR_USE_DENSE", "true").lower() in (
        "1",
        "true",
        "yes",
    )
    # Tenant isolation/per-tenant collection
    per_tenant_collections: bool = os.getenv(
        "RETR_PER_TENANT_COLLECTIONS", "false"
    ).lower() in ("1", "true", "yes")
    # RRF fusion parameters
    rrf_k: int = _get_int("RETR_RRF_K", 60)
    rrf_w_bm25: float = _get_float("RETR_RRF_W_BM25", 0.4)
    rrf_w_dense: float = _get_float("RETR_RRF_W_DENSE", 0.5)
    rrf_w_field_values: float = _get_float("RETR_RRF_W_FIELD_VALUES", 0.6)
    # Semantic-only fallback controls
    semantic_fallback_enabled: bool = os.getenv(
        "RETR_SEMANTIC_FALLBACK_ENABLED", "true"
    ).lower() in ("1", "true", "yes")
    semantic_fallback_topk_multiplier: int = _get_int(
        "RETR_SEMANTIC_FALLBACK_TOPK_MULT", 2
    )
    # BM25 corpus size limit when building tenant corpus
    bm25_corpus_limit: int = _get_int("RETR_BM25_CORPUS_LIMIT", 2000)
    # BM25 cache TTL seconds
    bm25_cache_ttl_s: int = _get_int("RETR_BM25_CACHE_TTL_S", 600)
    # DuckDB connection lifecycle controls
    duckdb_conn_ttl_s: int = _get_int("RETR_DUCKDB_CONN_TTL_S", 900)
    duckdb_max_conns: int = _get_int("RETR_DUCKDB_MAX_CONNS", 16)
    # Embedding and fine-tuning controls
    embedding_model: str = os.getenv("RAG_EMBED_MODEL", "text-embedding-3-large")
    fine_tune_enabled: bool = os.getenv("EMBED_FINE_TUNE_ENABLED", "false").lower() in (
        "1",
        "true",
        "yes",
    )
    fine_tune_model_path: str = os.getenv("EMBED_FINE_TUNE_MODEL_PATH", "")


@dataclass(frozen=True)
class RerankerConfig:
    # CrossEncoder设置
    cross_encoder_model: str = os.getenv(
        "RERANK_CROSS_ENCODER", "cross-encoder/ms-marco-electra-base"
    )
    cross_encoder_batch_size: int = _get_int("RERANK_BATCH_SIZE", 16)
    cross_encoder_max_length: int = _get_int("RERANK_MAX_LENGTH", 512)

    # LTR设置
    ltr_model_path: str = os.getenv("RERANK_LTR_MODEL_PATH", "")
    ltr_enabled: bool = os.getenv("RERANK_LTR_ENABLED", "false").lower() in (
        "1",
        "true",
        "yes",
    )

    # Enable/disable the reranker pipeline globally
    enabled: bool = os.getenv("RERANK_ENABLED", "true").lower() in ("1", "true", "yes")

    # 融合权重
    fusion_bi_weight: float = _get_float("RERANK_BI_WEIGHT", 0.3)
    fusion_cross_weight: float = _get_float("RERANK_CROSS_WEIGHT", 0.7)

    # 缓存设置
    cache_enabled: bool = os.getenv("RERANK_CACHE_ENABLED", "true").lower() in (
        "1",
        "true",
        "yes",
    )
    cache_ttl: int = _get_int("RERANK_CACHE_TTL", 3600)
    # Schema bias factor applied to matching contexts
    schema_bias_factor: float = _get_float("RERANK_SCHEMA_BIAS_FACTOR", 1.1)


@dataclass(frozen=True)
class QCConfig:
    citation_min_ratio_lookup: float = _get_float("QC_CITATION_MIN_RATIO_LOOKUP", 0.6)
    citation_min_ratio_compare: float = _get_float("QC_CITATION_MIN_RATIO_COMPARE", 0.6)
    citation_min_ratio_summary: float = _get_float("QC_CITATION_MIN_RATIO_SUMMARY", 0.4)
    hallucination_max_score: float = _get_float("QC_HALLUCINATION_MAX_SCORE", 0.4)
    max_answer_tokens: int = _get_int("QC_MAX_ANSWER_TOKENS", 1200)
    rewrite_max_attempts: int = _get_int("QC_REWRITE_MAX_ATTEMPTS", 1)
    remove_disclaimers: bool = os.getenv("QC_REMOVE_DISCLAIMERS", "true").lower() in (
        "1",
        "true",
        "yes",
    )
    tenant_policy_footer: str = os.getenv("QC_TENANT_POLICY_FOOTER", "")


# ------------------------------
# Reliability & Ops Config
# ------------------------------


@dataclass(frozen=True)
class RetryConfig:
    max_attempts: int = _get_int("RETRY_MAX_ATTEMPTS", 4)
    base_delay_ms: int = _get_int("RETRY_BASE_DELAY_MS", 200)
    max_delay_ms: int = _get_int("RETRY_MAX_DELAY_MS", 5000)
    jitter_ms: int = _get_int("RETRY_JITTER_MS", 200)
    queue_enabled: bool = os.getenv("RETRY_QUEUE_ENABLED", "true").lower() in (
        "1",
        "true",
        "yes",
    )
    queue_namespace: str = os.getenv("RETRY_QUEUE_NAMESPACE", "retry")


@dataclass(frozen=True)
class CircuitBreakerConfig:
    failure_threshold: int = _get_int("CB_FAILURE_THRESHOLD", 5)
    cooldown_ms: int = _get_int("CB_COOLDOWN_MS", 15000)
    half_open_probe: int = _get_int("CB_HALF_OPEN_PROBE", 1)
    tenant_aware: bool = os.getenv("CB_TENANT_AWARE", "true").lower() in (
        "1",
        "true",
        "yes",
    )


@dataclass(frozen=True)
class DBPoolConfig:
    pool_size: int = _get_int("DB_POOL_SIZE", 5)
    max_overflow: int = _get_int("DB_MAX_OVERFLOW", 10)
    pool_recycle: int = _get_int("DB_POOL_RECYCLE", 1800)
    pool_timeout: int = _get_int("DB_POOL_TIMEOUT", 30)
    echo: bool = os.getenv("DB_ECHO", "false").lower() in ("1", "true", "yes")


@dataclass(frozen=True)
class QdrantRecoveryConfig:
    health_interval_ms: int = _get_int("QDRANT_HEALTH_INTERVAL_MS", 5000)
    recovery_timeout_ms: int = _get_int("QDRANT_RECOVERY_TIMEOUT_MS", 30000)


@dataclass(frozen=True)
class TelemetryConfig:
    enable_metrics: bool = os.getenv("TELEMETRY_ENABLE_METRICS", "true").lower() in (
        "1",
        "true",
        "yes",
    )
    enable_logs: bool = os.getenv("TELEMETRY_ENABLE_LOGS", "true").lower() in (
        "1",
        "true",
        "yes",
    )


# ------------------------------
# Cost & Throttling Config
# ------------------------------


@dataclass(frozen=True)
class CostConfig:
    # USD per 1K tokens (defaults; override via env like COST_MODEL_gpt_4o_mini_in=0.003)
    model_in_usd_per_1k: dict = None  # type: ignore
    model_out_usd_per_1k: dict = None  # type: ignore
    persist_interval_s: int = _get_int("COST_PERSIST_INTERVAL_S", 60)

    def __init__(self):  # type: ignore
        object.__setattr__(
            self,
            "model_in_usd_per_1k",
            {
                os.getenv("RAG_CHAT_MODEL", "gpt-4o-mini"): float(
                    os.getenv("COST_MODEL_DEFAULT_IN", "0.003")
                ),
                os.getenv("RAG_EMBED_MODEL", "text-embedding-3-large"): float(
                    os.getenv("COST_MODEL_EMBED_IN", "0.0001")
                ),
            },
        )
        object.__setattr__(
            self,
            "model_out_usd_per_1k",
            {
                os.getenv("RAG_CHAT_MODEL", "gpt-4o-mini"): float(
                    os.getenv("COST_MODEL_DEFAULT_OUT", "0.006")
                ),
            },
        )


@dataclass(frozen=True)
class ThrottleConfig:
    # Concurrent request caps per tenant
    llm_concurrency_default: int = _get_int("THROTTLE_LLM_CONCURRENCY_DEFAULT", 3)
    embed_concurrency_default: int = _get_int("THROTTLE_EMBED_CONCURRENCY_DEFAULT", 5)
    # Optional per-tier overrides
    tier_llm_caps: dict = None  # type: ignore
    tier_embed_caps: dict = None  # type: ignore

    def __init__(self):  # type: ignore
        object.__setattr__(
            self,
            "tier_llm_caps",
            {
                "BASIC": _get_int("THROTTLE_LLM_BASIC", 2),
                "PRO": _get_int("THROTTLE_LLM_PRO", 5),
                "ENTERPRISE": _get_int("THROTTLE_LLM_ENTERPRISE", 10),
            },
        )
        object.__setattr__(
            self,
            "tier_embed_caps",
            {
                "BASIC": _get_int("THROTTLE_EMBED_BASIC", 4),
                "PRO": _get_int("THROTTLE_EMBED_PRO", 10),
                "ENTERPRISE": _get_int("THROTTLE_EMBED_ENTERPRISE", 20),
            },
        )


@dataclass(frozen=True)
class QuantizationConfig:
    enabled: bool = os.getenv("VECTOR_QUANT_ENABLED", "false").lower() in (
        "1",
        "true",
        "yes",
    )
    decimals: int = _get_int(
        "VECTOR_QUANT_DECIMALS", 3
    )  # simple rounding-based compression


# ------------------------------
# Quality Gate Config (CI)
# ------------------------------


@dataclass(frozen=True)
class QualityGateConfig:
    enable_gating: bool = os.getenv("QUALITY_GATING_ENABLED", "true").lower() in (
        "1",
        "true",
        "yes",
    )
    min_precision: float = _get_float("QUALITY_MIN_PRECISION", 0.50)
    min_recall: float = _get_float("QUALITY_MIN_RECALL", 0.50)
    min_f1: float = _get_float("QUALITY_MIN_F1", 0.50)
    max_avg_latency_ms: int = _get_int("QUALITY_MAX_AVG_LATENCY_MS", 4000)
    tier_prod_min_f1: float = _get_float("QUALITY_TIER_PROD_MIN_F1", 0.65)
    tier_staging_min_f1: float = _get_float("QUALITY_TIER_STAGING_MIN_F1", 0.55)


# Singleton-style accessors
chunking = ChunkingConfig()
retrieval = RetrievalConfig()
reranker_config = RerankerConfig()  # 新增的
qc = QCConfig()
retries = RetryConfig()
circuit_breaker = CircuitBreakerConfig()
db_pool = DBPoolConfig()
qdrant_recovery = QdrantRecoveryConfig()
telemetry = TelemetryConfig()
cost = CostConfig()
throttle = ThrottleConfig()
quant = QuantizationConfig()
quality_gate = QualityGateConfig()


# ------------------------------
# Connector & Scheduler Config
# ------------------------------


@dataclass(frozen=True)
class ConnectorConfig:
    enabled: bool = os.getenv("CONNECTORS_ENABLED", "false").lower() in (
        "1",
        "true",
        "yes",
    )
    # comma-separated list of connector names to load
    enabled_names: str = os.getenv(
        "CONNECTORS_LIST", "sharepoint,googledrive,salesforce"
    )
    # default sync interval seconds
    default_interval_s: int = _get_int("CONNECTOR_DEFAULT_INTERVAL_S", 900)
    # run scheduler loop
    scheduler_enabled: bool = os.getenv(
        "CONNECTOR_SCHEDULER_ENABLED", "true"
    ).lower() in ("1", "true", "yes")
    # optional manifest JSON file mapping connectors to tenants
    manifest_json_path: str = os.getenv("CONNECTOR_MANIFEST_JSON", "")
    # cursor TTL seconds for connector delta checkpoints
    cursor_ttl_seconds: int = _get_int("CONNECTOR_CURSOR_TTL_S", 7 * 24 * 3600)


connectors = ConnectorConfig()


# ------------------------------
# Agent Config
# ------------------------------


@dataclass(frozen=True)
class AgentConfig:
    enabled: bool = os.getenv("AGENTS_ENABLED", "false").lower() in ("1", "true", "yes")
    max_steps: int = _get_int("AGENT_MAX_STEPS", 6)
    max_tokens_reasoning: int = _get_int("AGENT_MAX_TOKENS_REASONING", 4000)
    time_budget_ms: int = _get_int("AGENT_TIME_BUDGET_MS", 20000)
    sandbox_mode: bool = os.getenv("AGENT_SANDBOX", "true").lower() in (
        "1",
        "true",
        "yes",
    )
    sandbox_feature_flag: bool = os.getenv("AGENT_SANDBOX_ENABLED", "true").lower() in (
        "1",
        "true",
        "yes",
    )
    tool_default_timeout_ms: int = _get_int("AGENT_TOOL_DEFAULT_TIMEOUT_MS", 15000)
    tool_retry_max: int = _get_int("AGENT_TOOL_RETRY_MAX", 2)
    tool_retry_backoff_ms: int = _get_int("AGENT_TOOL_RETRY_BACKOFF_MS", 300)
    rate_limit_qps_global: int = _get_int("AGENT_RATE_LIMIT_QPS_GLOBAL", 3)
    rate_limit_qps_per_tool: int = _get_int("AGENT_RATE_LIMIT_QPS_PER_TOOL", 2)
    require_approval_for_external_domains: bool = os.getenv(
        "AGENT_REQUIRE_APPROVAL_EXTERNAL", "true"
    ).lower() in ("1", "true", "yes")
    sql_allowlist_enabled: bool = os.getenv(
        "AGENT_SQL_ALLOWLIST_ENABLED", "true"
    ).lower() in ("1", "true", "yes")
    file_export_allowed_buckets: str = os.getenv(
        "AGENT_FILE_EXPORT_ALLOWED_BUCKETS", "tenant-${id}/"
    )


agents = AgentConfig()


# ------------------------------
# Memory Config
# ------------------------------


@dataclass(frozen=True)
class MemoryConfig:
    ttl_days: int = _get_int("MEMORY_TTL_DAYS", 7)
    summary_trigger_turns: int = _get_int("MEMORY_SUMMARY_TRIGGER", 5)
    max_context_tokens: int = _get_int("MEMORY_MAX_CONTEXT_TOKENS", 3000)
    prune_strategy: str = os.getenv("MEMORY_PRUNE_STRATEGY", "oldest").lower()
    pii_extended: bool = os.getenv("MEMORY_PII_EXTENDED", "false").lower() in (
        "1",
        "true",
        "yes",
    )


memory = MemoryConfig()


# ------------------------------
# Vault / Secret Manager Config
# ------------------------------


@dataclass(frozen=True)
class VaultConfig:
    enabled: bool = os.getenv("VAULT_ENABLED", "false").lower() in ("1", "true", "yes")
    addr: str = os.getenv("VAULT_ADDR", "")
    token: str = os.getenv("VAULT_TOKEN", "")
    mount_path: str = os.getenv(
        "VAULT_MOUNT_PATH", "secret/data/ai_core"
    )  # KVv2: secret/data/<path>
    refresh_interval_s: int = _get_int("VAULT_REFRESH_INTERVAL_S", 600)
    cache_ttl_s: int = _get_int("VAULT_CACHE_TTL_S", 600)
    system_tenant_id: str = os.getenv(
        "VAULT_SYSTEM_TENANT_ID", "00000000-0000-0000-0000-000000000001"
    )


@dataclass(frozen=True)
class VaultRotationConfig:
    token_renew_interval_s: int = _get_int("VAULT_TOKEN_RENEW_INTERVAL_S", 300)
    ttl_alert_threshold_s: int = _get_int("VAULT_TTL_ALERT_THRESHOLD_S", 3600)
    renew_backoff_base_s: int = _get_int("VAULT_RENEW_BACKOFF_BASE_S", 5)
    renew_backoff_max_s: int = _get_int("VAULT_RENEW_BACKOFF_MAX_S", 300)


vault = VaultConfig()
vault_rotation = VaultRotationConfig()


@dataclass(frozen=True)
class RetentionDefaults:
    dry_run: bool = os.getenv("RETENTION_DRY_RUN", "true").lower() in (
        "1",
        "true",
        "yes",
    )
    enforce_interval_s: int = _get_int("RETENTION_ENFORCE_INTERVAL_S", 3600)
    # default days per data type
    doc_days: int = _get_int("RET_DOC_DAYS", 365)
    audit_days: int = _get_int("RET_AUDIT_DAYS", 365)
    feedback_days: int = _get_int("RET_FEEDBACK_DAYS", 180)
    conv_days: int = _get_int("RET_CONV_DAYS", 90)
    embed_cache_days: int = _get_int("RET_EMBED_CACHE_DAYS", 30)
    cost_days: int = _get_int("RET_COST_DAYS", 90)


retention_defaults = RetentionDefaults()


# ------------------------------
# Agent Approval Worker Config
# ------------------------------


@dataclass(frozen=True)
class AgentApprovalConfig:
    poll_interval_s: int = _get_int("AGENT_APPROVAL_POLL_INTERVAL_S", 15)
    batch_size: int = _get_int("AGENT_APPROVAL_BATCH_SIZE", 10)
    retry_max: int = _get_int("AGENT_APPROVAL_RETRY_MAX", 3)
    retry_backoff_ms: int = _get_int("AGENT_APPROVAL_RETRY_BACKOFF_MS", 1000)


agent_approval = AgentApprovalConfig()


# ------------------------------
# Compliance Reporting Config
# ------------------------------


from dataclasses import dataclass as _dataclass  # alias to avoid confusion


@_dataclass(frozen=True)
class ComplianceConfig:
    # Scheduler cadence and reporting window
    schedule_interval_s: int = _get_int("COMPLIANCE_SCHEDULE_INTERVAL_S", 24 * 3600)
    reporting_period_days: int = _get_int("COMPLIANCE_REPORTING_PERIOD_DAYS", 7)

    # Thresholds used to score compliance
    threshold_backup_freshness_hours: int = _get_int(
        "COMPLIANCE_BACKUP_FRESHNESS_HOURS", 24
    )
    threshold_rto_seconds: int = _get_int("COMPLIANCE_RTO_SECONDS", 3600)
    threshold_retention_lag_seconds: int = _get_int(
        "COMPLIANCE_RETENTION_LAG_SECONDS", 24 * 3600
    )
    threshold_vault_rotation_days: int = _get_int(
        "COMPLIANCE_VAULT_ROTATION_DAYS", 7
    )

    # CI build gate minimum overall compliance score (0..1)
    quality_gate_min_compliance: float = _get_float(
        "QUALITY_GATE_MIN_COMPLIANCE", 0.90
    )


compliance = ComplianceConfig()
