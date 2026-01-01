"""
SQLAlchemy data models for the Omnichannel Enterprise RAG Chatbot Platform.
"""
from sqlalchemy import (
    Column,
    String,
    Text,
    DateTime,
    Boolean,
    Integer,
    JSON,
    ForeignKey,
    Index,
    LargeBinary,
    SmallInteger,
)
from sqlalchemy.types import TypeDecorator, CHAR, Enum
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
import enum
from sqlalchemy.dialects import postgresql

Base = declarative_base()


class GUID(TypeDecorator):
    """Platform-independent GUID/UUID type.

    Uses PostgreSQL UUID type, otherwise stores as CHAR(36) string.
    """

    impl = CHAR
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(postgresql.UUID(as_uuid=True))
        return dialect.type_descriptor(CHAR(36))

    def process_bind_param(self, value, dialect):
        if value is None:
            return value
        if isinstance(value, uuid.UUID):
            return value if dialect.name == "postgresql" else str(value)
        # Coerce strings to UUID
        coerced = uuid.UUID(str(value))
        return coerced if dialect.name == "postgresql" else str(coerced)

    def process_result_value(self, value, dialect):
        if value is None:
            return value
        if isinstance(value, uuid.UUID):
            return value
        return uuid.UUID(str(value))


class Tenant(Base):
    """Tenant model representing an organization."""

    __tablename__ = "tenants"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    domain = Column(String(255), unique=True, nullable=False)
    subscription_tier = Column(String(50), default="BASIC")
    settings = Column(JSON, default=dict)
    # Whitelabel / Custom Domain fields
    custom_domain = Column(String(255))  # e.g., ai.company.com
    custom_domain_status = Column(String(32), default="none")  # none|pending_dns|pending_tls|active|error
    ssl_cert_secret = Column(String(255))  # K8s secret name for issued cert
    brand_assets_uri = Column(String(500))  # bucket/URL containing logo, favicon, colors.json
    oauth_redirect_uris = Column(JSON, default=list)  # list of redirect URIs derived from domain
    csp_exceptions = Column(JSON, default=list)  # optional allowlist for 3rd-party assets
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    # Relationships
    users = relationship("User", back_populates="tenant", cascade="all, delete-orphan")
    conversations = relationship(
        "Conversation", back_populates="tenant", cascade="all, delete-orphan"
    )
    knowledge_bases = relationship(
        "KnowledgeBase", back_populates="tenant", cascade="all, delete-orphan"
    )

    def __repr__(self):
        return f"<Tenant(id={self.id}, name={self.name}, domain={self.domain})>"


class User(Base):
    """User model for both internal staff and external customers."""

    __tablename__ = "users"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(GUID(), ForeignKey("tenants.id"), nullable=False)
    external_id = Column(String(255))  # Channel-specific user identifier
    user_type = Column(
        String(50), nullable=False
    )  # INTERNAL_STAFF or EXTERNAL_CUSTOMER
    role = Column(String(50), default="END_USER")  # ADMIN, MANAGER, AGENT, END_USER
    preferences = Column(JSON, default=dict)
    last_active_at = Column(DateTime, default=func.now())
    created_at = Column(DateTime, default=func.now())

    # Relationships
    tenant = relationship("Tenant", back_populates="users")
    conversations = relationship(
        "Conversation", back_populates="user", cascade="all, delete-orphan"
    )

    def __repr__(self):
        return f"<User(id={self.id}, tenant_id={self.tenant_id}, user_type={self.user_type})>"


class Conversation(Base):
    """Conversation model maintaining context across channels."""

    __tablename__ = "conversations"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(GUID(), ForeignKey("tenants.id"), nullable=False)
    user_id = Column(GUID(), ForeignKey("users.id"), nullable=False)
    channel = Column(
        String(50), nullable=False
    )  # whatsapp, wechat, line, telegram, web, teams
    status = Column(String(50), default="ACTIVE")  # ACTIVE, COMPLETED, ESCALATED
    context = Column(JSON, default=dict)  # Conversation state and metadata
    channel_context = Column(JSON, default=dict)  # Per-channel identifiers and state
    started_at = Column(DateTime, default=func.now())
    last_message_at = Column(DateTime, default=func.now())
    completed_at = Column(DateTime)

    # Relationships
    tenant = relationship("Tenant", back_populates="conversations")
    user = relationship("User", back_populates="conversations")
    messages = relationship(
        "Message", back_populates="conversation", cascade="all, delete-orphan"
    )

    def __repr__(self):
        return f"<Conversation(id={self.id}, tenant_id={self.tenant_id}, channel={self.channel})>"


class Message(Base):
    """Message model for individual communications."""

    __tablename__ = "messages"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    conversation_id = Column(GUID(), ForeignKey("conversations.id"), nullable=False)
    sender_type = Column(String(50), nullable=False)  # USER, SYSTEM, HUMAN_AGENT
    content = Column(Text, nullable=False)
    message_type = Column(
        String(50), default="TEXT"
    )  # TEXT, IMAGE, FILE, BUTTON_RESPONSE
    meta = Column("metadata", JSON, default=dict)  # Channel-specific message data
    timestamp = Column(DateTime, default=func.now())
    is_processed = Column(Boolean, default=False)  # Whether RAG processing completed

    # Relationships
    conversation = relationship("Conversation", back_populates="messages")

    def __repr__(self):
        return f"<Message(id={self.id}, conversation_id={self.conversation_id}, sender_type={self.sender_type})>"


class KnowledgeBase(Base):
    """Knowledge base model for organizing documents."""

    __tablename__ = "knowledge_bases"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(GUID(), ForeignKey("tenants.id"), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    status = Column(String(50), default="ACTIVE")  # ACTIVE, BUILDING, ARCHIVED
    document_count = Column(Integer, default=0)
    last_updated_at = Column(DateTime, default=func.now())
    created_at = Column(DateTime, default=func.now())

    # Relationships
    tenant = relationship("Tenant", back_populates="knowledge_bases")
    documents = relationship(
        "Document", back_populates="knowledge_base", cascade="all, delete-orphan"
    )

    def __repr__(self):
        return f"<KnowledgeBase(id={self.id}, tenant_id={self.tenant_id}, name={self.name})>"


class Document(Base):
    """Document model for knowledge base content."""

    __tablename__ = "documents"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    knowledge_base_id = Column(GUID(), ForeignKey("knowledge_bases.id"), nullable=False)
    title = Column(String(255), nullable=False)
    content = Column(Text, nullable=False)
    raw_encrypted = Column(LargeBinary)
    enc_ver = Column(SmallInteger, default=0)
    source_url = Column(String(500))
    meta = Column("metadata", JSON, default=dict)  # Author, publish_date, tags, etc.
    status = Column(String(50), default="PROCESSING")  # PROCESSING, INDEXED, FAILED
    chunk_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=func.now())
    indexed_at = Column(DateTime)

    # Relationships
    knowledge_base = relationship("KnowledgeBase", back_populates="documents")
    chunks = relationship(
        "KnowledgeChunk", back_populates="document", cascade="all, delete-orphan"
    )

    def __repr__(self):
        return f"<Document(id={self.id}, knowledge_base_id={self.knowledge_base_id}, title={self.title})>"


class KnowledgeChunk(Base):
    """Knowledge chunk model with vector embeddings."""

    __tablename__ = "knowledge_chunks"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    document_id = Column(GUID(), ForeignKey("documents.id"), nullable=False)
    content = Column(Text, nullable=False)  # Chunk text content (~700 characters)
    chunk_index = Column(Integer, nullable=False)  # Position within document
    embedding = Column(JSON)  # Vector embedding stored as JSON array
    content_encrypted = Column(LargeBinary)
    enc_ver = Column(SmallInteger, default=0)
    meta = Column("metadata", JSON, default=dict)  # Chunk-level metadata
    created_at = Column(DateTime, default=func.now())

    # Relationships
    document = relationship("Document", back_populates="chunks")

    def __repr__(self):
        return f"<KnowledgeChunk(id={self.id}, document_id={self.document_id}, chunk_index={self.chunk_index})>"


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(GUID(), ForeignKey("tenants.id"), nullable=False)
    user_id = Column(GUID())
    api_key_id = Column(GUID())
    correlation_id = Column(String(64))
    auth_type = Column(String(20))  # jwt, api_key, anonymous
    category = Column(String(50))  # access, modification, ingestion, generation, admin
    action = Column(String(100), nullable=False)
    resource = Column(String(255))
    classification = Column(String(50))
    origin = Column(String(100))
    request_hash = Column(String(64))
    response_hash = Column(String(64))
    success = Column(Boolean, default=True)
    latency_ms = Column(Integer, default=0)
    model = Column(String(100))
    token_input = Column(Integer)
    token_output = Column(Integer)
    extra = Column(JSON, default=dict)
    created_at = Column(DateTime, default=func.now(), index=True)


Index("idx_audit_tenant_created", AuditLog.tenant_id, AuditLog.created_at)


class ApiKey(Base):
    __tablename__ = "api_keys"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(GUID(), ForeignKey("tenants.id"), nullable=False)
    name = Column(String(255), nullable=False)
    key_hash = Column(String(64), unique=True, nullable=False)
    scopes = Column(
        JSON, default=list
    )  # list of allowed actions like ["retrieval:read", "ingestion:*"]
    rate_limit_per_minute = Column(Integer, default=0)
    expires_at = Column(DateTime)
    revoked_at = Column(DateTime)
    created_by = Column(GUID())
    last_used_at = Column(DateTime)
    created_at = Column(DateTime, default=func.now())


Index("idx_apikey_tenant", ApiKey.tenant_id)


class CostSummary(Base):
    __tablename__ = "cost_summaries"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(GUID(), ForeignKey("tenants.id"), nullable=False)
    model = Column(String(100), nullable=False)
    kind = Column(String(30), nullable=False)  # chat|embed
    window_start = Column(DateTime, default=func.now())
    window_end = Column(DateTime, default=func.now())
    tokens_in = Column(Integer, default=0)
    tokens_out = Column(Integer, default=0)
    cost_usd = Column(Integer)  # store in cents to avoid float
    created_at = Column(DateTime, default=func.now())


Index(
    "idx_cost_tenant_window",
    CostSummary.tenant_id,
    CostSummary.window_start,
    CostSummary.window_end,
)


class TenantRerankConfig(Base):
    __tablename__ = "tenant_rerank_config"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(GUID(), ForeignKey("tenants.id"), nullable=False)
    w_bm25 = Column(Integer, default=40)  # store as int percent for simplicity
    w_dense = Column(Integer, default=50)
    w_field_values = Column(Integer, default=60)
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


Index(
    "idx_rerank_tenant_active", TenantRerankConfig.tenant_id, TenantRerankConfig.active
)


class FeedbackEvent(Base):
    __tablename__ = "feedback_events"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(GUID(), ForeignKey("tenants.id"), nullable=False)
    user_id = Column(GUID())
    query = Column(Text, nullable=False)
    predicted_intent = Column(String(50))
    final_response = Column(Text)
    label = Column(String(50))  # helpful|unhelpful|correct|incorrect|intent_mismatch
    meta = Column(JSON, default=dict)
    created_at = Column(DateTime, default=func.now(), index=True)


Index("idx_feedback_tenant_created", FeedbackEvent.tenant_id, FeedbackEvent.created_at)


class EvalRun(Base):
    __tablename__ = "eval_runs"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(GUID(), ForeignKey("tenants.id"), nullable=False)
    model = Column(String(100))
    eval_type = Column(String(50))  # retrieval|generation|end2end
    suite_name = Column(String(100))
    started_at = Column(DateTime, default=func.now())
    completed_at = Column(DateTime)
    precision_at_k = Column(Integer)
    recall_at_k = Column(Integer)
    f1 = Column(Integer)
    exact_match = Column(Integer)
    avg_latency_ms = Column(Integer)
    meta = Column(JSON, default=dict)


Index("idx_eval_tenant_started", EvalRun.tenant_id, EvalRun.started_at)


class ConversationMemory(Base):
    __tablename__ = "conversation_memory"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(GUID(), ForeignKey("tenants.id"), nullable=False)
    session_id = Column(GUID(), nullable=False)
    role = Column(String(16), nullable=False)  # user | assistant
    content = Column(Text, nullable=False)
    summary = Column(Text)
    created_at = Column(DateTime, default=func.now(), index=True)
    expires_at = Column(DateTime)


Index(
    "idx_mem_tenant_session_created",
    ConversationMemory.tenant_id,
    ConversationMemory.session_id,
    ConversationMemory.created_at,
)


class Approval(Base):
    __tablename__ = "approvals"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(GUID(), ForeignKey("tenants.id"), nullable=False)
    tool_id = Column(String(100), nullable=False)
    action_payload_hash = Column(String(64), nullable=False)
    action_payload_json = Column(Text)
    requested_by = Column(GUID())
    status = Column(String(20), default="pending")  # pending|approved|denied
    reason = Column(Text)
    decided_by = Column(GUID())
    created_at = Column(DateTime, default=func.now(), index=True)
    decided_at = Column(DateTime)
    executed = Column(Boolean, default=False)
    executed_at = Column(DateTime)
    output_summary = Column(Text)
    output_hash = Column(String(64))
    deleted_at = Column(DateTime)


Index(
    "idx_approvals_tenant_status",
    Approval.tenant_id,
    Approval.status,
    Approval.created_at,
)
try:
    # PostgreSQL partial index for ready-to-execute approvals
    Index(
        "idx_approvals_ready_exec",
        Approval.created_at,
        postgresql_where=(
            (Approval.status == "approved")
            & (Approval.executed == False)
            & (Approval.deleted_at == None)
        ),
    )
except Exception:
    # Fallback generic composite index for other DBs
    Index(
        "idx_approvals_exec_generic",
        Approval.status,
        Approval.executed,
        Approval.created_at,
    )


class RetentionPolicy(Base):
    __tablename__ = "retention_policies"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(GUID(), ForeignKey("tenants.id"), nullable=False)
    data_type = Column(String(50), nullable=False)
    max_age_days = Column(Integer, nullable=False, default=30)
    archive_before_delete = Column(Boolean, default=True)
    encryption_required = Column(Boolean, default=True)
    last_enforced_at = Column(DateTime)
    created_at = Column(DateTime, default=func.now())


Index(
    "idx_retention_tenant_type",
    RetentionPolicy.tenant_id,
    RetentionPolicy.data_type,
)


class ArchiveRegistry(Base):
    __tablename__ = "archive_registry"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(GUID(), ForeignKey("tenants.id"), nullable=False)
    system = Column(String(30), nullable=False)
    object_id = Column(String(128), nullable=False)
    storage_path = Column(String(500), nullable=False)
    checksum_sha256 = Column(String(64))
    size_bytes = Column(Integer)
    expires_at = Column(DateTime)
    created_at = Column(DateTime, default=func.now())


Index(
    "idx_archive_tenant_system",
    ArchiveRegistry.tenant_id,
    ArchiveRegistry.system,
)


class ComplianceReport(Base):
    __tablename__ = "compliance_reports"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(GUID(), ForeignKey("tenants.id"), nullable=False)
    # Storage path for the JSON artifact (e.g., s3://bucket/key or file://...)
    artifact_path = Column(String(500), nullable=False)
    artifact_checksum_sha256 = Column(String(64), nullable=False)
    status = Column(String(20), default="generated")  # generated|failed
    retention_days = Column(Integer, default=365)
    generator_version = Column(String(32), default="v1")
    period_start = Column(DateTime)
    period_end = Column(DateTime)
    summary = Column(JSON, default=dict)  # lightweight summary for dashboard
    created_at = Column(DateTime, default=func.now(), index=True)


Index(
    "idx_compliance_tenant_created",
    ComplianceReport.tenant_id,
    ComplianceReport.created_at,
)


# Tenant lifecycle models
class TenantAction(Base):
    __tablename__ = "tenant_actions"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(GUID(), nullable=False, index=True)
    action = Column(String(64), nullable=False)
    actor = Column(String(128))
    status = Column(String(32), nullable=False, default="pending")
    reason = Column(String(255))
    extra = Column(JSON, default=dict)
    created_at = Column(DateTime, default=func.now(), index=True)
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class TenantMigration(Base):
    __tablename__ = "tenant_migrations"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(GUID(), nullable=False, index=True)
    from_plan = Column(String(32), nullable=False)
    to_plan = Column(String(32), nullable=False)
    migration_type = Column(String(16), nullable=False)  # soft|full
    status = Column(String(32), nullable=False, default="pending")
    started_at = Column(DateTime)
    finished_at = Column(DateTime)
    stats = Column(JSON, default=dict)
    error = Column(Text)


class TenantConnector(Base):
    __tablename__ = "tenant_connectors"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(GUID(), nullable=False, index=True)
    connector_id = Column(String(64), nullable=False, index=True)
    status = Column(String(32), nullable=False, default="inactive")
    config = Column(JSON, default=dict)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())


class ConnectorSyncRecord(Base):
    __tablename__ = "connector_sync_records"

    id = Column(GUID(), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(GUID(), nullable=False, index=True)
    connector_id = Column(String(64), nullable=False, index=True)
    started_at = Column(DateTime, default=func.now())
    finished_at = Column(DateTime)
    record_count = Column(Integer, default=0)
    bytes = Column(Integer, default=0)
    success = Column(Boolean, default=False)
    errors = Column(JSON, default=dict)


class BuyerStage(str, enum.Enum):
    """Buyer stage enumeration."""

    AWARENESS = "AWARENESS"
    EVALUATING = "EVALUATING"
    READY = "READY"


class Brand(Base):
    __tablename__ = "Brand"
    __table_args__ = {"schema": "core"}

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    workspace_id = Column(String(36), nullable=False) # ForeignKey("core.Account.id") omitted as Account not defined here
    name = Column(Text, nullable=False)
    domain = Column(Text, nullable=False)
    domain_context = Column(JSON, nullable=False)
    status = Column(Text, default="ACTIVE", nullable=False)
    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())
    
    # Relationships
    # account = relationship("Account", back_populates="brands")
    leads = relationship("LeadOpportunity", back_populates="brand")
    drafts = relationship("OutreachDraft", back_populates="brand")


class RecommendedAction(str, enum.Enum):
    """Recommended action enumeration."""

    SILENT_CAPTURE = "SILENT_CAPTURE"
    RECOMMEND_DM = "RECOMMEND_DM"
    PRIORITY_DM = "PRIORITY_DM"


class LeadOpportunity(Base):
    """Lead opportunity model for qualified buyer interception."""

    __tablename__ = "LeadOpportunity"  # Matches Prisma model name case-sensitive if quotes used in Prisma, but usually prisma maps to lower or snake.
    # Prisma 'model LeadOpportunity' maps to table "LeadOpportunity" (quoted) or "LeadOpportunity"?
    # Prisma default: uses model name. Postgres default: lowercase.
    # Prisma schema defines `model LeadOpportunity`. If no @@map, it uses "LeadOpportunity".
    # In Postgres, unquoted identifiers are lowercase. Prisma quotes them.
    # To match Prisma, we often need to be careful.
    # Let's check other models. `model User` -> `__tablename__ = "users"`.
    # Wait, Prisma schema had:
    # model User { ... @@schema("core") }
    # Here models.py has `class User(Base): __tablename__ = "users"`.
    # Prisma defaults model name to PascalCase but DB table often mapped?
    # No, Prisma schema showed NO `@@map`.
    # Standard Prisma: `model User` -> table `User` (if not mapped).
    # BUT existing `models.py` has lowercase table names!
    # `class Tenant` -> `__tablename__ = "tenants"`
    # `class User` -> `__tablename__ = "users"`
    # This implies the Prisma schema DOES map them or keysmatch constraint.
    # Let me check schema.prisma again for `User` mapping?
    # schema.prisma: `model User { ... }` No @@map.
    # This suggests a discrepancy or I missed something.
    # Wait, `schema.prisma` lines 18: `model Account`.
    # `models.py` doesn't seem to have `Account`. It has `Tenant`, `User`.
    # Ah! `syntrae_platform` seems to have split schemas or mixed conventions.
    # `apps/ingestion-service` uses `Account` (Prisma). `ai-core` uses `Tenant` (SQLAlchemy).
    # Are they the same table?
    # `schema.prisma`: `model Account { ... installs InstallRegistry[] ... }`
    # `models.py`: `class Tenant`...
    # This looks like `ai-core` has its OWN tables?
    # `models.py` line 58: `class Tenant(Base): __tablename__ = "tenants"`
    # `schema.prisma`: `model Account`.
    # If I create `LeadOpportunity` in Prisma, it will create table `LeadOpportunity`.
    # Python needs to map to `LeadOpportunity`.
    # Ideally, I should check if `ai-core` reads `EngagementEvent`.
    # `models.py` does NOT have `EngagementEvent`!
    # This means `ai-core` does NOT strictly map the Ingestion Service schema yet!
    # It seems `ai-core` has its own RAG tables (`documents`, `chunks`), and `ingestion-service` has `EngagementEvent`.
    # The Prompt said: "Ensure they mirror the Prisma schema changes."
    # AND "ai-core explicitly owns writing LeadOpportunity".
    # So `ai-core` needs to access `LeadOpportunity` table created by Prisma.
    # Prisma created table `LeadOpportunity` (PascalCase if quoted, but likely `LeadOpportunity` in PG).
    # I should use `__tablename__ = "LeadOpportunity"` to match Prisma's default.

    __tablename__ = "LeadOpportunity"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    platform = Column(String(50), nullable=False)
    video_id = Column(String(255), nullable=False)
    comment_id = Column(String(255), nullable=False)
    user_handle = Column(String(255))
    user_profile_url = Column(String(500))
    intent = Column(String(100), nullable=False)
    buyer_stage = Column(
        Enum(BuyerStage, name="BuyerStage", schema="core", create_type=False),
        nullable=False
    )
    confidence = Column(postgresql.DOUBLE_PRECISION, nullable=False)
    preferences = Column(JSON, nullable=True)
    recommended_action = Column(
        Enum(RecommendedAction, name="RecommendedAction", schema="core", create_type=False),
        nullable=False
    )
    urgency_score = Column(postgresql.DOUBLE_PRECISION, default=0.0)
    risk_level = Column(String(20), default="LOW")
    source_event_id = Column(String(36), nullable=False)  # ID from EngagementEvent
    account_id = Column(String(36), nullable=False)  # Tenant/Account ownership
    created_at = Column(DateTime, default=func.now())

    brand_id = Column(String(36), ForeignKey("core.Brand.id"), nullable=False)
    brand = relationship("Brand", back_populates="leads")

    # Constraints
    # @@unique([platform, comment_id]) -> UniqueConstraint in SQLAlchemy
    __table_args__ = (
        Index("idx_leadopp_platform_comment", "platform", "comment_id", unique=True),
        {"schema": "core"}, # Prisma uses @@schema("core")
    )

    drafts = relationship("OutreachDraft", back_populates="lead")

class OutreachDraft(Base):
    __tablename__ = "OutreachDraft"
    __table_args__ = {"schema": "core"}

    id = Column(String(36), primary_key=True)
    lead_id = Column(String(36), ForeignKey("core.LeadOpportunity.id"), nullable=False)
    account_id = Column(String(36), nullable=False)
    platform = Column(String(50), nullable=False)
    buyer_stage = Column(String(50), nullable=False)
    tone = Column(String(50), nullable=False)
    language = Column(String(50), nullable=False)
    draft_text = Column(String, nullable=False)
    edited_text = Column(String, nullable=True) # Phase 37.4
    generation_meta = Column(JSON, nullable=False)
    
    # Phase 37.4 Lifecycle
    status = Column(String(50), default="DRAFT", nullable=False)
    generated_by = Column(String(50), default="AI_CORE")
    confidence = Column(postgresql.DOUBLE_PRECISION, nullable=True)
    
    normalization_version = Column(String(50), nullable=True)
    intent_score = Column(postgresql.DOUBLE_PRECISION, nullable=True)
    
    approved_by_user_id = Column(String(36), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    sent_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, default=func.now())
    updated_at = Column(DateTime, default=func.now(), onupdate=func.now())

    lead = relationship("LeadOpportunity", back_populates="drafts")

    brand_id = Column(String(36), ForeignKey("core.Brand.id"), nullable=False)
    brand = relationship("Brand", back_populates="drafts")

class ManualSendEvent(Base):
    __tablename__ = "ManualSendEvent"
    __table_args__ = (
        {"schema": "core"}
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    draft_id = Column(String(36), nullable=False) # Loose coupling or FK? Schema says index.
    lead_id = Column(String(36), nullable=False)
    brand_id = Column(String(36), nullable=False)
    
    sent_text = Column(String, nullable=False)
    sent_by_user_id = Column(String(36), nullable=False)
    sent_at = Column(DateTime, default=func.now())
    
    platform = Column(String(50), nullable=False)
    send_mode = Column(String(50), nullable=False)
    confirmation_ack = Column(Boolean, default=False)
    
    notes = Column(String, nullable=True)
    created_at = Column(DateTime, default=func.now())
