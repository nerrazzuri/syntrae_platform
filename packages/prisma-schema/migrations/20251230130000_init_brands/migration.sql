-- AlterTable
ALTER TABLE "core"."EngagementEvent" ADD COLUMN     "brand_id" TEXT;

-- AlterTable
ALTER TABLE "core"."LeadOpportunity" ADD COLUMN     "brand_id" TEXT;

-- AlterTable
ALTER TABLE "core"."OutreachDraft" ADD COLUMN     "brand_id" TEXT;

-- CreateTable
CREATE TABLE "core"."Brand" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "domain_context" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Brand_workspace_id_idx" ON "core"."Brand"("workspace_id");

-- CreateIndex
CREATE INDEX "EngagementEvent_brand_id_idx" ON "core"."EngagementEvent"("brand_id");

-- CreateIndex
CREATE INDEX "LeadOpportunity_brand_id_idx" ON "core"."LeadOpportunity"("brand_id");

-- CreateIndex
CREATE INDEX "OutreachDraft_brand_id_idx" ON "core"."OutreachDraft"("brand_id");

-- AddForeignKey
ALTER TABLE "core"."Brand" ADD CONSTRAINT "Brand_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "core"."Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."EngagementEvent" ADD CONSTRAINT "EngagementEvent_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "core"."Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."LeadOpportunity" ADD CONSTRAINT "LeadOpportunity_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "core"."Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."OutreachDraft" ADD CONSTRAINT "OutreachDraft_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "core"."Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
