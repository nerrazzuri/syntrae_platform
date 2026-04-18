CREATE TABLE "core"."WorkspaceCreditLedger" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "credit_type" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "description" TEXT,
    "period_start" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceCreditLedger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceCreditLedger_workspace_id_credit_type_source_type_source_id_key"
ON "core"."WorkspaceCreditLedger"("workspace_id", "credit_type", "source_type", "source_id");

CREATE INDEX "WorkspaceCreditLedger_workspace_id_credit_type_created_at_idx"
ON "core"."WorkspaceCreditLedger"("workspace_id", "credit_type", "created_at");

CREATE INDEX "WorkspaceCreditLedger_workspace_id_credit_type_period_start_idx"
ON "core"."WorkspaceCreditLedger"("workspace_id", "credit_type", "period_start");

CREATE INDEX "WorkspaceCreditLedger_workspace_id_credit_type_expires_at_idx"
ON "core"."WorkspaceCreditLedger"("workspace_id", "credit_type", "expires_at");

ALTER TABLE "core"."WorkspaceCreditLedger"
ADD CONSTRAINT "WorkspaceCreditLedger_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "core"."Account"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
