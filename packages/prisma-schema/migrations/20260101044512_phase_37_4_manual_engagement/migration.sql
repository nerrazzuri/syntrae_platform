-- CreateEnum
CREATE TYPE "core"."PolicyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "core"."PolicyMode" AS ENUM ('SAFE', 'BALANCED', 'AGGRESSIVE');

-- CreateEnum
CREATE TYPE "core"."RunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'ABORTED', 'FAILED');

-- AlterTable
ALTER TABLE "core"."OutreachDraft" ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by_user_id" TEXT,
ADD COLUMN     "confidence" DOUBLE PRECISION,
ADD COLUMN     "edited_text" TEXT,
ADD COLUMN     "generated_by" TEXT NOT NULL DEFAULT 'AI_CORE',
ADD COLUMN     "intent_score" DOUBLE PRECISION,
ADD COLUMN     "normalization_version" TEXT,
ADD COLUMN     "sent_at" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "core"."ManualSendEvent" (
    "id" TEXT NOT NULL,
    "draft_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "sent_text" TEXT NOT NULL,
    "sent_by_user_id" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "platform" TEXT NOT NULL,
    "send_mode" TEXT NOT NULL,
    "confirmation_ack" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualSendEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."AutomationPolicy" (
    "id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "status" "core"."PolicyStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "mode" "core"."PolicyMode" NOT NULL DEFAULT 'SAFE',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "relevance_min_score" INTEGER NOT NULL DEFAULT 70,
    "intent_min_score" INTEGER NOT NULL DEFAULT 60,
    "allow_capture_seen_events" BOOLEAN NOT NULL DEFAULT true,
    "max_videos_per_hour" INTEGER NOT NULL DEFAULT 20,
    "max_comments_per_video" INTEGER NOT NULL DEFAULT 30,
    "max_comments_per_hour" INTEGER NOT NULL DEFAULT 200,
    "max_leads_per_day" INTEGER NOT NULL DEFAULT 30,
    "cooldown_ms_between_actions" INTEGER NOT NULL DEFAULT 2500,
    "random_jitter_ms" INTEGER NOT NULL DEFAULT 1500,
    "platform_limits" JSONB NOT NULL DEFAULT '{}',
    "quiet_hours" JSONB NOT NULL DEFAULT '{}',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "core"."AutomationRun" (
    "id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "install_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "status" "core"."RunStatus" NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "policy_id" TEXT NOT NULL,
    "policy_snapshot" JSONB NOT NULL,
    "stats" JSONB NOT NULL DEFAULT '{}',
    "abort_reason" TEXT,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManualSendEvent_brand_id_idx" ON "core"."ManualSendEvent"("brand_id");

-- CreateIndex
CREATE INDEX "ManualSendEvent_draft_id_idx" ON "core"."ManualSendEvent"("draft_id");

-- CreateIndex
CREATE INDEX "ManualSendEvent_sent_by_user_id_idx" ON "core"."ManualSendEvent"("sent_by_user_id");

-- CreateIndex
CREATE INDEX "AutomationPolicy_brand_id_status_idx" ON "core"."AutomationPolicy"("brand_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationPolicy_brand_id_version_key" ON "core"."AutomationPolicy"("brand_id", "version");

-- CreateIndex
CREATE INDEX "AutomationRun_brand_id_idx" ON "core"."AutomationRun"("brand_id");

-- CreateIndex
CREATE INDEX "AutomationRun_install_id_idx" ON "core"."AutomationRun"("install_id");

-- AddForeignKey
ALTER TABLE "core"."AutomationPolicy" ADD CONSTRAINT "AutomationPolicy_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "core"."Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."AutomationRun" ADD CONSTRAINT "AutomationRun_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "core"."AutomationPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
