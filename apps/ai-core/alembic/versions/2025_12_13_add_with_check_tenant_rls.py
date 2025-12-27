"""
Add WITH CHECK to tenant RLS policies to enforce write isolation.

Revision ID: add_with_check_tenant_rls_20251213
Revises: enable_tenant_rls_20251206
Create Date: 2025-12-13 00:00:00
"""
from alembic import op


# revision identifiers, used by Alembic.
revision = "add_with_check_tenant_rls_20251213"
down_revision = "enable_tenant_rls_20251206"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Only apply to PostgreSQL
    conn = op.get_bind()
    dialect = conn.engine.dialect.name
    if dialect != "postgresql":
        return

    # Ensure all tenant tables have a policy that includes BOTH USING and WITH CHECK
    # If policy exists: ALTER it to include WITH CHECK
    # If policy missing: ENABLE/FORCE RLS and CREATE policy with USING + WITH CHECK
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
      EXECUTE format(
        'ALTER POLICY tenant_isolation ON %I.%I USING (tenant_id = current_setting(''app.tenant_id'')::uuid) WITH CHECK (tenant_id = current_setting(''app.tenant_id'')::uuid)',
        r.table_schema, r.table_name
      );
    EXCEPTION WHEN undefined_object THEN
      -- Policy does not exist: enable/force RLS and create policy
      BEGIN
        EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.table_schema, r.table_name);
        EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', r.table_schema, r.table_name);
        EXECUTE format(
          'CREATE POLICY tenant_isolation ON %I.%I USING (tenant_id = current_setting(''app.tenant_id'')::uuid) WITH CHECK (tenant_id = current_setting(''app.tenant_id'')::uuid)',
          r.table_schema, r.table_name
        );
      EXCEPTION WHEN duplicate_object THEN
        NULL;
      END;
    END;
  END LOOP;
END$$;
        """
    )


def downgrade() -> None:
    # Only apply to PostgreSQL
    conn = op.get_bind()
    dialect = conn.engine.dialect.name
    if dialect != "postgresql":
        return

    # Revert to USING-only policy (previous behavior before this migration)
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
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I.%I USING (tenant_id = current_setting(''app.tenant_id'')::uuid)',
        r.table_schema, r.table_name
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END$$;
        """
    )
