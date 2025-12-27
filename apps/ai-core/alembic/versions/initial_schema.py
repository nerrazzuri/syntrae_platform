"""Initial schema migration

Revision ID: 001
Revises:
Create Date: 2025-10-13 14:47:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create tenant template schema
    op.execute("CREATE SCHEMA IF NOT EXISTS tenant_template")

    # Create base tables in tenant_template
    op.create_table(
        "tenants",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("domain", sa.String(255), nullable=False),
        sa.Column("subscription_tier", sa.String(50), nullable=True),
        sa.Column("settings", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        schema="tenant_template",
    )

    op.create_index(
        "ix_tenant_template_tenants_domain",
        "tenants",
        ["domain"],
        unique=True,
        schema="tenant_template",
    )

    op.create_table(
        "users",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("tenant_id", sa.UUID(), nullable=False),
        sa.Column("external_id", sa.String(255), nullable=True),
        sa.Column("user_type", sa.String(50), nullable=False),
        sa.Column("role", sa.String(50), nullable=True),
        sa.Column("preferences", sa.JSON(), nullable=True),
        sa.Column("last_active_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ["tenant_id"], ["tenant_template.tenants.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        schema="tenant_template",
    )

    op.create_table(
        "conversations",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("tenant_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("channel", sa.String(50), nullable=False),
        sa.Column("status", sa.String(50), nullable=True),
        sa.Column("context", sa.JSON(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("last_message_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ["tenant_id"], ["tenant_template.tenants.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["tenant_template.users.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        schema="tenant_template",
    )

    op.create_table(
        "messages",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("conversation_id", sa.UUID(), nullable=False),
        sa.Column("sender_type", sa.String(50), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("message_type", sa.String(50), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("timestamp", sa.DateTime(), nullable=True),
        sa.Column("is_processed", sa.Boolean(), nullable=True),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["tenant_template.conversations.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        schema="tenant_template",
    )

    op.create_table(
        "knowledge_bases",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("tenant_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("status", sa.String(50), nullable=True),
        sa.Column("document_count", sa.Integer(), nullable=True),
        sa.Column("last_updated_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ["tenant_id"], ["tenant_template.tenants.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        schema="tenant_template",
    )

    op.create_table(
        "documents",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("knowledge_base_id", sa.UUID(), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("source_url", sa.String(500), nullable=True),
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("status", sa.String(50), nullable=True),
        sa.Column("chunk_count", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("indexed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ["knowledge_base_id"],
            ["tenant_template.knowledge_bases.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        schema="tenant_template",
    )

    op.create_table(
        "knowledge_chunks",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("document_id", sa.UUID(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column(
            "embedding", sa.String(), nullable=True
        ),  # Vector data stored as JSON string
        sa.Column("metadata", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ["document_id"], ["tenant_template.documents.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        schema="tenant_template",
    )

    # Create indexes for performance
    op.create_index(
        "ix_tenant_template_users_tenant_id",
        "users",
        ["tenant_id"],
        schema="tenant_template",
    )
    op.create_index(
        "ix_tenant_template_conversations_tenant_id",
        "conversations",
        ["tenant_id"],
        schema="tenant_template",
    )
    op.create_index(
        "ix_tenant_template_conversations_user_id",
        "conversations",
        ["user_id"],
        schema="tenant_template",
    )
    op.create_index(
        "ix_tenant_template_conversations_status",
        "conversations",
        ["status"],
        schema="tenant_template",
    )
    op.create_index(
        "ix_tenant_template_messages_conversation_id",
        "messages",
        ["conversation_id"],
        schema="tenant_template",
    )
    op.create_index(
        "ix_tenant_template_messages_timestamp",
        "messages",
        ["timestamp"],
        schema="tenant_template",
    )
    op.create_index(
        "ix_tenant_template_documents_knowledge_base_id",
        "documents",
        ["knowledge_base_id"],
        schema="tenant_template",
    )
    op.create_index(
        "ix_tenant_template_knowledge_bases_tenant_id",
        "knowledge_bases",
        ["tenant_id"],
        schema="tenant_template",
    )
    op.create_index(
        "ix_tenant_template_knowledge_chunks_document_id",
        "knowledge_chunks",
        ["document_id"],
        schema="tenant_template",
    )


def downgrade() -> None:
    # Drop indexes
    op.drop_index(
        "ix_tenant_template_knowledge_chunks_document_id",
        table_name="knowledge_chunks",
        schema="tenant_template",
    )
    op.drop_index(
        "ix_tenant_template_knowledge_bases_tenant_id",
        table_name="knowledge_bases",
        schema="tenant_template",
    )
    op.drop_index(
        "ix_tenant_template_documents_knowledge_base_id",
        table_name="documents",
        schema="tenant_template",
    )
    op.drop_index(
        "ix_tenant_template_messages_timestamp",
        table_name="messages",
        schema="tenant_template",
    )
    op.drop_index(
        "ix_tenant_template_messages_conversation_id",
        table_name="messages",
        schema="tenant_template",
    )
    op.drop_index(
        "ix_tenant_template_conversations_status",
        table_name="conversations",
        schema="tenant_template",
    )
    op.drop_index(
        "ix_tenant_template_conversations_user_id",
        table_name="conversations",
        schema="tenant_template",
    )
    op.drop_index(
        "ix_tenant_template_conversations_tenant_id",
        table_name="conversations",
        schema="tenant_template",
    )
    op.drop_index(
        "ix_tenant_template_users_tenant_id",
        table_name="users",
        schema="tenant_template",
    )

    # Drop tables
    op.drop_table("knowledge_chunks", schema="tenant_template")
    op.drop_table("documents", schema="tenant_template")
    op.drop_table("knowledge_bases", schema="tenant_template")
    op.drop_table("messages", schema="tenant_template")
    op.drop_table("conversations", schema="tenant_template")
    op.drop_table("users", schema="tenant_template")
    op.drop_table("tenants", schema="tenant_template")

    # Drop schema
    op.execute("DROP SCHEMA IF EXISTS tenant_template CASCADE")
