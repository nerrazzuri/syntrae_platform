ALTER TABLE "core"."Account"
ALTER COLUMN "plan_id" SET DEFAULT 'STARTER';

UPDATE "core"."Account"
SET "plan_id" = CASE UPPER(COALESCE("plan_id", ''))
  WHEN 'FREE' THEN 'STARTER'
  WHEN 'BASIC' THEN 'GROWTH'
  WHEN 'MIGRATED_BASIC' THEN 'GROWTH'
  WHEN 'PRO' THEN 'PRO'
  WHEN 'BUSINESS' THEN 'AGENCY'
  WHEN 'ENTERPRISE' THEN 'AGENCY'
  WHEN 'DEV' THEN 'PRO'
  WHEN 'STARTER' THEN 'STARTER'
  WHEN 'GROWTH' THEN 'GROWTH'
  WHEN 'AGENCY' THEN 'AGENCY'
  ELSE 'STARTER'
END;

CREATE TABLE "core"."WorkspaceSubscription" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "plan_code" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "billing_interval" TEXT NOT NULL DEFAULT 'MONTHLY',
  "is_trial" BOOLEAN NOT NULL DEFAULT false,
  "trial_ends_at" TIMESTAMP(3),
  "current_period_start" TIMESTAMP(3),
  "current_period_end" TIMESTAMP(3),
  "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
  "scheduled_plan_code" TEXT,
  "addon_config" JSONB NOT NULL DEFAULT '{}',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WorkspaceSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceSubscription_workspace_id_key"
  ON "core"."WorkspaceSubscription"("workspace_id");

CREATE INDEX "WorkspaceSubscription_plan_code_status_idx"
  ON "core"."WorkspaceSubscription"("plan_code", "status");

ALTER TABLE "core"."WorkspaceSubscription"
ADD CONSTRAINT "WorkspaceSubscription_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "core"."Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "core"."WorkspaceSubscription" (
  "id",
  "workspace_id",
  "plan_code",
  "display_name",
  "status",
  "billing_interval",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid()::text,
  a."id",
  a."plan_id",
  CASE a."plan_id"
    WHEN 'STARTER' THEN 'Starter'
    WHEN 'GROWTH' THEN 'Growth'
    WHEN 'PRO' THEN 'Pro'
    WHEN 'AGENCY' THEN 'Agency'
    ELSE 'Starter'
  END,
  CASE WHEN a."status" = 'ACTIVE' THEN 'ACTIVE' ELSE 'INACTIVE' END,
  'MONTHLY',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "core"."Account" a
ON CONFLICT ("workspace_id") DO NOTHING;

CREATE TABLE "core"."WorkspaceUsageCounter" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "brand_id" TEXT,
  "scope_key" TEXT NOT NULL,
  "metric_code" TEXT NOT NULL,
  "period_type" TEXT NOT NULL,
  "period_start" TIMESTAMP(3) NOT NULL,
  "current_value" INTEGER NOT NULL DEFAULT 0,
  "blocked_at" TIMESTAMP(3),
  "block_reason_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WorkspaceUsageCounter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceUsageCounter_workspace_scope_metric_period_key"
  ON "core"."WorkspaceUsageCounter"("workspace_id", "scope_key", "metric_code", "period_type", "period_start");

CREATE INDEX "WorkspaceUsageCounter_workspace_metric_period_idx"
  ON "core"."WorkspaceUsageCounter"("workspace_id", "metric_code", "period_type", "period_start");

CREATE INDEX "WorkspaceUsageCounter_brand_metric_period_idx"
  ON "core"."WorkspaceUsageCounter"("brand_id", "metric_code", "period_type", "period_start");

ALTER TABLE "core"."WorkspaceUsageCounter"
ADD CONSTRAINT "WorkspaceUsageCounter_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "core"."Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "core"."WorkspaceUsageCounter"
ADD CONSTRAINT "WorkspaceUsageCounter_brand_id_fkey"
FOREIGN KEY ("brand_id") REFERENCES "core"."Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
