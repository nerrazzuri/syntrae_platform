-- AlterTable
ALTER TABLE "core"."AutomationRun"
ADD COLUMN     "claimed_by" TEXT,
ADD COLUMN     "claim_token" TEXT,
ADD COLUMN     "claimed_at" TIMESTAMP(3),
ADD COLUMN     "heartbeat_at" TIMESTAMP(3),
ADD COLUMN     "lease_expires_at" TIMESTAMP(3),
ADD COLUMN     "attempt_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "next_retry_at" TIMESTAMP(3),
ADD COLUMN     "last_error" TEXT;

-- CreateIndex
CREATE INDEX "AutomationRun_status_started_at_idx" ON "core"."AutomationRun"("status", "started_at");

-- CreateIndex
CREATE INDEX "AutomationRun_status_lease_expires_at_idx" ON "core"."AutomationRun"("status", "lease_expires_at");

-- CreateIndex
CREATE INDEX "AutomationRun_status_next_retry_at_idx" ON "core"."AutomationRun"("status", "next_retry_at");

-- CreateIndex
CREATE INDEX "AutomationRun_claimed_by_idx" ON "core"."AutomationRun"("claimed_by");
