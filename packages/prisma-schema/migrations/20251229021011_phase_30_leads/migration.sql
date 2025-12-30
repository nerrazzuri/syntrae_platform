-- CreateEnum
CREATE TYPE "core"."BuyerStage" AS ENUM ('AWARENESS', 'EVALUATING', 'READY');

-- CreateEnum
CREATE TYPE "core"."RecommendedAction" AS ENUM ('SILENT_CAPTURE', 'RECOMMEND_DM', 'PRIORITY_DM');

-- CreateTable
CREATE TABLE "core"."LeadOpportunity" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "video_id" TEXT NOT NULL,
    "comment_id" TEXT NOT NULL,
    "user_handle" TEXT,
    "user_profile_url" TEXT,
    "intent" TEXT NOT NULL,
    "buyer_stage" "core"."BuyerStage" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "preferences" JSONB,
    "recommended_action" "core"."RecommendedAction" NOT NULL,
    "urgency_score" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "risk_level" TEXT NOT NULL DEFAULT 'LOW',
    "source_event_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadOpportunity_platform_comment_id_key" ON "core"."LeadOpportunity"("platform", "comment_id");

-- AddForeignKey
ALTER TABLE "core"."LeadOpportunity" ADD CONSTRAINT "LeadOpportunity_source_event_id_fkey" FOREIGN KEY ("source_event_id") REFERENCES "core"."EngagementEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
