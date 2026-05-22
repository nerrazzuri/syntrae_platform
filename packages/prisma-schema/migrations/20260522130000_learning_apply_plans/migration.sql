-- CreateEnum
CREATE TYPE "core"."LearningApplyPlanStatus" AS ENUM (
    'DRAFT',
    'REVIEWED',
    'CANCELLED',
    'SUPERSEDED'
);

-- CreateTable
CREATE TABLE "core"."LearningApplyPlan" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "brand_id" TEXT,
    "platform" TEXT,
    "learning_suggestion_id" TEXT NOT NULL,
    "status" "core"."LearningApplyPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "target_area" TEXT NOT NULL,
    "proposed_change_type" TEXT NOT NULL,
    "risk_level" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "proposed_patch" JSONB,
    "proposed_config_change" JSONB,
    "suggested_tests" JSONB,
    "blocked_auto_apply_reason" TEXT,
    "requires_human_approval" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL DEFAULT 'SYSTEM',
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningApplyPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LearningApplyPlan_account_id_created_at_idx" ON "core"."LearningApplyPlan"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "LearningApplyPlan_brand_id_created_at_idx" ON "core"."LearningApplyPlan"("brand_id", "created_at");

-- CreateIndex
CREATE INDEX "LearningApplyPlan_learning_suggestion_id_idx" ON "core"."LearningApplyPlan"("learning_suggestion_id");

-- CreateIndex
CREATE INDEX "LearningApplyPlan_status_created_at_idx" ON "core"."LearningApplyPlan"("status", "created_at");

-- CreateIndex
CREATE INDEX "LearningApplyPlan_target_area_proposed_change_type_idx" ON "core"."LearningApplyPlan"("target_area", "proposed_change_type");
