"""Enable tenant RLS and policies on all tables with tenant_id.

Revision ID: enable_tenant_rls_20251206
Revises: 
Create Date: 2025-12-06 00:00:00
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'enable_tenant_rls_20251206'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Only apply to PostgreSQL
    conn = op.get_bind()
    dialect = conn.engine.dialect.name
    if dialect != "postgresql":
        return
    # Loop all public tables with tenant_id and enable RLS with a tenant policy
    op.execute(
        """
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_schema, c.table_name
    FROM information_schema.columns c
    WHERE c.column_name = 'tenant_id'
      AND c.table_schema = 'public'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.table_schema, r.table_name);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', r.table_schema, r.table_name);
    BEGIN
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I.%I USING (tenant_id = current_setting(''app.tenant_id'')::uuid)',
        r.table_schema, r.table_name
      );
    EXCEPTION WHEN duplicate_object THEN
      -- Ignore if policy already exists
      NULL;
    END;
  END LOOP;
END$$;
        """
    )


def downgrade() -> None:
    conn = op.get_bind()
    dialect = conn.engine.dialect.name
    if dialect != "postgresql":
        return
    # Best-effort drop policy and disable RLS
    op.execute(
        """
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_schema, c.table_name
    FROM information_schema.columns c
    WHERE c.column_name = 'tenant_id'
      AND c.table_schema = 'public'
  LOOP
    BEGIN
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I.%I', r.table_schema, r.table_name);
    EXCEPTION WHEN undefined_object THEN
      NULL;
    END;
    EXECUTE format('ALTER TABLE %I.%I DISABLE ROW LEVEL SECURITY', r.table_schema, r.table_name);
  END LOOP;
END$$;
        """
    )


