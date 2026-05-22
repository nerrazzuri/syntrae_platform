-- CreateEnum
CREATE TYPE "core"."ReplyWatchStatus" AS ENUM (
    'WAITING_USER_REPLY',
    'USER_REPLIED',
    'FOLLOW_UP_READY',
    'EXPIRED_NO_REPLY',
    'CLOSED'
);

-- CreateTable
CREATE TABLE "core"."ReplyWatch" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "brand_id" TEXT,
    "lead_id" TEXT,
    "outreach_draft_id" TEXT,
    "platform" TEXT NOT NULL,
    "source_post_id" TEXT,
    "source_comment_id" TEXT,
    "parent_comment_id" TEXT,
    "thread_key" TEXT,
    "status" "core"."ReplyWatchStatus" NOT NULL DEFAULT 'WAITING_USER_REPLY',
    "reason" TEXT,
    "reply_strategy" TEXT,
    "reply_mode" TEXT,
    "product_grounding_mode" TEXT,
    "buyer_stage" TEXT,
    "watch_until" TIMESTAMP(3) NOT NULL,
    "last_checked_at" TIMESTAMP(3),
    "last_seen_reply_id" TEXT,
    "user_replied_at" TIMESTAMP(3),
    "follow_up_ready_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReplyWatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReplyWatch_account_id_status_watch_until_idx" ON "core"."ReplyWatch"("account_id", "status", "watch_until");

-- CreateIndex
CREATE INDEX "ReplyWatch_platform_source_comment_id_idx" ON "core"."ReplyWatch"("platform", "source_comment_id");

-- CreateIndex
CREATE INDEX "ReplyWatch_thread_key_idx" ON "core"."ReplyWatch"("thread_key");

-- CreateIndex
CREATE INDEX "ReplyWatch_lead_id_idx" ON "core"."ReplyWatch"("lead_id");

-- CreateIndex
CREATE INDEX "ReplyWatch_outreach_draft_id_idx" ON "core"."ReplyWatch"("outreach_draft_id");
