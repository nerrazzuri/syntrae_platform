"""
Enforce tenant_id on writes using triggers (default + validate).

Revision ID: enforce_tenant_id_triggers_20251213
Revises: add_with_check_tenant_rls_20251213
Create Date: 2025-12-13 00:15:00
"""
from alembic import op


# revision identifiers, used by Alembic.
revision = "enforce_tenant_id_triggers_20251213"
down_revision = "add_with_check_tenant_rls_20251213"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Only apply to PostgreSQL
    conn = op.get_bind()
    dialect = conn.engine.dialect.name
    if dialect != "postgresql":
        return

    # 1) Create or replace the generic trigger function once
    op.execute(
        """
CREATE OR REPLACE FUNCTION public.enforce_tenant_id_guard()
RETURNS trigger AS $$
DECLARE
  app_tid TEXT;
  app_tid_uuid UUID;
BEGIN
  app_tid := current_setting('app.tenant_id', true);
  IF app_tid IS NULL OR app_tid = '' THEN
    RAISE EXCEPTION 'app.tenant_id is not set in session (RLS write guard)';
  END IF;
  app_tid_uuid := app_tid::uuid;

  IF TG_OP = 'INSERT' THEN
    -- Default missing tenant_id to session tenant
    IF NEW.tenant_id IS NULL THEN
      NEW.tenant_id := app_tid_uuid;
    END IF;
    -- Validate mismatch
    IF NEW.tenant_id IS DISTINCT FROM app_tid_uuid THEN
      RAISE EXCEPTION 'tenant_id mismatch on INSERT (%% <> %%)', NEW.tenant_id, app_tid_uuid;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Forbid changing tenant_id and validate against session
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'tenant_id change is forbidden on UPDATE';
    END IF;
    IF NEW.tenant_id IS DISTINCT FROM app_tid_uuid THEN
      RAISE EXCEPTION 'tenant_id mismatch on UPDATE (%% <> %%)', NEW.tenant_id, app_tid_uuid;
    END IF;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql SECURITY DEFINER;
        """
    )

    # 2) Attach triggers to all public tables with a tenant_id column
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
    -- Drop existing trigger if present to avoid duplicates
    EXECUTE format('DROP TRIGGER IF EXISTS trg_enforce_tenant_id ON %I.%I', r.table_schema, r.table_name);
    -- Create a BEFORE INSERT OR UPDATE trigger that calls the guard
    EXECUTE format(
      'CREATE TRIGGER trg_enforce_tenant_id BEFORE INSERT OR UPDATE ON %I.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_tenant_id_guard()',
      r.table_schema, r.table_name
    );
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

    # 1) Drop triggers from all public tables with tenant_id
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
    EXECUTE format('DROP TRIGGER IF EXISTS trg_enforce_tenant_id ON %I.%I', r.table_schema, r.table_name);
  END LOOP;
END$$;
        """
    )

    # 2) Drop the function
    op.execute("DROP FUNCTION IF EXISTS public.enforce_tenant_id_guard() CASCADE;")
