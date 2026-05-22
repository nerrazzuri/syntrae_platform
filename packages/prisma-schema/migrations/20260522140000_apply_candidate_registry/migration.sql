-- CreateEnum
CREATE TYPE "core"."ApplyCandidateStatus" AS ENUM (
    'PENDING',
    'ACCEPTED',
    'REJECTED',
    'ARCHIVED',
    'IMPLEMENTED'
);

-- CreateEnum
CREATE TYPE "core"."ApplyCandidateType" AS ENUM (
    'BANNED_PHRASE',
    'STYLE_GUIDANCE',
    'DRAFT_QC_TEST_CASE',
    'INTENT_MAPPING_TEST_CASE',
    'PRODUCT_GROUNDING_REVIEW',
    'BRAND_PROFILE_HINT',
    'FOLLOW_UP_PROMPT_TEST_CASE',
    'OTHER'
);

-- CreateTable
CREATE TABLE "core"."ApplyCandidate" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "brand_id" TEXT,
    "platform" TEXT,
    "learning_suggestion_id" TEXT,
    "learning_apply_plan_id" TEXT,
    "candidate_type" "core"."ApplyCandidateType" NOT NULL,
    "status" "core"."ApplyCandidateStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "candidate_payload" JSONB NOT NULL,
    "source_feedback_ids" JSONB NOT NULL DEFAULT '[]',
    "risk_level" TEXT NOT NULL,
    "created_by" TEXT NOT NULL DEFAULT 'SYSTEM',
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "implemented_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplyCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApplyCandidate_account_id_created_at_idx" ON "core"."ApplyCandidate"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "ApplyCandidate_brand_id_created_at_idx" ON "core"."ApplyCandidate"("brand_id", "created_at");

-- CreateIndex
CREATE INDEX "ApplyCandidate_platform_created_at_idx" ON "core"."ApplyCandidate"("platform", "created_at");

-- CreateIndex
CREATE INDEX "ApplyCandidate_learning_suggestion_id_idx" ON "core"."ApplyCandidate"("learning_suggestion_id");

-- CreateIndex
CREATE INDEX "ApplyCandidate_learning_apply_plan_id_idx" ON "core"."ApplyCandidate"("learning_apply_plan_id");

-- CreateIndex
CREATE INDEX "ApplyCandidate_candidate_type_status_idx" ON "core"."ApplyCandidate"("candidate_type", "status");

-- CreateIndex
CREATE INDEX "ApplyCandidate_status_created_at_idx" ON "core"."ApplyCandidate"("status", "created_at");
