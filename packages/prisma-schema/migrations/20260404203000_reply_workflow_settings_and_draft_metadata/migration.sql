ALTER TABLE "core"."OwnerSettings"
ADD COLUMN "reply_qualified_mode" TEXT NOT NULL DEFAULT 'MANUAL_REVIEW',
ADD COLUMN "reply_redirect_target" TEXT NOT NULL DEFAULT 'STORE',
ADD COLUMN "reply_cta_style" TEXT NOT NULL DEFAULT 'SOFT',
ADD COLUMN "reply_require_human_review_high_risk" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "auto_reply_confidence_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.9;

ALTER TABLE "core"."OutreachDraft"
ADD COLUMN "source_language" TEXT,
ADD COLUMN "draft_kind" TEXT NOT NULL DEFAULT 'PUBLIC_REPLY',
ADD COLUMN "reply_channel" TEXT NOT NULL DEFAULT 'THREAD_REPLY',
ADD COLUMN "cta_target" TEXT,
ADD COLUMN "cta_label" TEXT,
ADD COLUMN "risk_flags" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "delivery_error" TEXT;
