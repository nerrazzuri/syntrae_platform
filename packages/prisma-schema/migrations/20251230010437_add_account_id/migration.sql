/*
  Warnings:

  - Added the required column `account_id` to the `LeadOpportunity` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "core"."LeadOpportunity" ADD COLUMN     "account_id" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "core"."OutreachDraft" (
    "id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "buyer_stage" "core"."BuyerStage" NOT NULL,
    "tone" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "draft_text" TEXT NOT NULL,
    "generation_meta" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutreachDraft_account_id_created_at_idx" ON "core"."OutreachDraft"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "OutreachDraft_lead_id_idx" ON "core"."OutreachDraft"("lead_id");

-- AddForeignKey
ALTER TABLE "core"."LeadOpportunity" ADD CONSTRAINT "LeadOpportunity_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "core"."Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."OutreachDraft" ADD CONSTRAINT "OutreachDraft_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "core"."LeadOpportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
