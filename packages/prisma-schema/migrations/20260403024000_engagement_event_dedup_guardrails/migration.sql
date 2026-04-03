-- AlterTable
ALTER TABLE "core"."EngagementEvent"
ADD COLUMN     "semantic_dedup_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "EngagementEvent_semantic_dedup_key_key" ON "core"."EngagementEvent"("semantic_dedup_key");

-- CreateIndex
CREATE INDEX "EngagementEvent_account_id_platform_video_id_created_at_idx" ON "core"."EngagementEvent"("account_id", "platform", "video_id", "created_at");
