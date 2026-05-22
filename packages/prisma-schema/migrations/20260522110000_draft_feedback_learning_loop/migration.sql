-- CreateEnum
CREATE TYPE "core"."DraftFeedbackType" AS ENUM (
    'ACCEPTED_AS_IS',
    'EDITED_BEFORE_SEND',
    'REJECTED',
    'NEEDS_REWRITE',
    'WRONG_STRATEGY',
    'WRONG_TONE',
    'TOO_AI',
    'TOO_SALESY',
    'TOO_VAGUE',
    'UNSAFE_OR_OVERCLAIM',
    'OTHER'
);

-- CreateTable
CREATE TABLE "core"."DraftFeedback" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "outreach_draft_id" TEXT NOT NULL,
    "reply_watch_id" TEXT,
    "platform" TEXT,
    "feedback_type" "core"."DraftFeedbackType" NOT NULL,
    "human_edited_text" TEXT,
    "feedback_note" TEXT,
    "selected_reasons" JSONB NOT NULL DEFAULT '[]',
    "original_draft_text" TEXT NOT NULL,
    "final_sent_text" TEXT,
    "reply_strategy" TEXT,
    "reply_mode" TEXT,
    "product_grounding_mode" TEXT,
    "buyer_stage" TEXT,
    "intent" TEXT,
    "qc_status" JSONB,
    "generation_meta" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DraftFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DraftFeedback_account_id_created_at_idx" ON "core"."DraftFeedback"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "DraftFeedback_brand_id_created_at_idx" ON "core"."DraftFeedback"("brand_id", "created_at");

-- CreateIndex
CREATE INDEX "DraftFeedback_outreach_draft_id_idx" ON "core"."DraftFeedback"("outreach_draft_id");

-- CreateIndex
CREATE INDEX "DraftFeedback_reply_watch_id_idx" ON "core"."DraftFeedback"("reply_watch_id");

-- CreateIndex
CREATE INDEX "DraftFeedback_feedback_type_idx" ON "core"."DraftFeedback"("feedback_type");
