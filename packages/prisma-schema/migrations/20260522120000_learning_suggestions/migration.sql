-- CreateEnum
CREATE TYPE "core"."LearningSuggestionStatus" AS ENUM (
    'OPEN',
    'ACCEPTED',
    'REJECTED',
    'APPLIED',
    'ARCHIVED'
);

-- CreateEnum
CREATE TYPE "core"."LearningSuggestionType" AS ENUM (
    'PROMPT_STYLE_REVIEW',
    'BANNED_PHRASE_CANDIDATE',
    'CTA_GATING_REVIEW',
    'INTENT_MAPPING_REVIEW',
    'PRODUCT_GROUNDING_REVIEW',
    'DRAFT_QC_RULE_REVIEW',
    'FOLLOW_UP_PROMPT_REVIEW',
    'BRAND_PROFILE_REVIEW',
    'OTHER'
);

-- CreateTable
CREATE TABLE "core"."LearningSuggestion" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "brand_id" TEXT,
    "platform" TEXT,
    "suggestion_type" "core"."LearningSuggestionType" NOT NULL,
    "status" "core"."LearningSuggestionStatus" NOT NULL DEFAULT 'OPEN',
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "proposed_action" JSONB NOT NULL,
    "source_insight" JSONB NOT NULL,
    "source_feedback_ids" JSONB NOT NULL DEFAULT '[]',
    "created_by" TEXT NOT NULL DEFAULT 'SYSTEM',
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "review_note" TEXT,
    "applied_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningSuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LearningSuggestion_account_id_created_at_idx" ON "core"."LearningSuggestion"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "LearningSuggestion_brand_id_created_at_idx" ON "core"."LearningSuggestion"("brand_id", "created_at");

-- CreateIndex
CREATE INDEX "LearningSuggestion_platform_created_at_idx" ON "core"."LearningSuggestion"("platform", "created_at");

-- CreateIndex
CREATE INDEX "LearningSuggestion_suggestion_type_status_idx" ON "core"."LearningSuggestion"("suggestion_type", "status");

-- CreateIndex
CREATE INDEX "LearningSuggestion_status_created_at_idx" ON "core"."LearningSuggestion"("status", "created_at");
