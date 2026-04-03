-- 1. Alter Columns to NOT NULL
ALTER TABLE "core"."EngagementEvent" ALTER COLUMN "brand_id" SET NOT NULL;
ALTER TABLE "core"."LeadOpportunity" ALTER COLUMN "brand_id" SET NOT NULL;
ALTER TABLE "core"."OutreachDraft" ALTER COLUMN "brand_id" SET NOT NULL;

-- 2. Drop old Foreign Keys (configured with ON DELETE SET NULL)
ALTER TABLE "core"."EngagementEvent" DROP CONSTRAINT "EngagementEvent_brand_id_fkey";
ALTER TABLE "core"."LeadOpportunity" DROP CONSTRAINT "LeadOpportunity_brand_id_fkey";
ALTER TABLE "core"."OutreachDraft" DROP CONSTRAINT "OutreachDraft_brand_id_fkey";

-- 3. Add new Foreign Keys (configured with ON DELETE RESTRICT)
ALTER TABLE "core"."EngagementEvent" ADD CONSTRAINT "EngagementEvent_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "core"."Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "core"."LeadOpportunity" ADD CONSTRAINT "LeadOpportunity_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "core"."Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "core"."OutreachDraft" ADD CONSTRAINT "OutreachDraft_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "core"."Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
