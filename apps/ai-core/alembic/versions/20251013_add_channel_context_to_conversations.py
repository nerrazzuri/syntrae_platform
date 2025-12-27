"""add channel_context to conversations

Revision ID: 20251013_add_channel_context
Revises: initial_schema
Create Date: 2025-10-13
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20251013_add_channel_context"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("conversations") as batch_op:
        batch_op.add_column(sa.Column("channel_context", sa.JSON(), nullable=True))


def downgrade():
    with op.batch_alter_table("conversations") as batch_op:
        batch_op.drop_column("channel_context")
