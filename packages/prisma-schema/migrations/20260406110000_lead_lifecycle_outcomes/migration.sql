CREATE TYPE "core"."LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST');

CREATE TYPE "core"."OutcomeSource" AS ENUM ('MANUAL', 'INTEGRATED', 'ESTIMATED');

ALTER TABLE "core"."LeadOpportunity"
ADD COLUMN "lead_status" "core"."LeadStatus" NOT NULL DEFAULT 'NEW',
ADD COLUMN "followed_up_at" TIMESTAMP(3),
ADD COLUMN "converted_at" TIMESTAMP(3),
ADD COLUMN "deal_value" DOUBLE PRECISION,
ADD COLUMN "outcome_reason" TEXT,
ADD COLUMN "outcome_source" "core"."OutcomeSource" NOT NULL DEFAULT 'MANUAL';

UPDATE "core"."LeadOpportunity"
SET "lead_status" = CASE
    WHEN "buyer_stage" = 'READY' THEN 'QUALIFIED'::"core"."LeadStatus"
    WHEN "buyer_stage" = 'EVALUATING' THEN 'NEW'::"core"."LeadStatus"
    ELSE 'NEW'::"core"."LeadStatus"
END
WHERE "lead_status" = 'NEW';

CREATE INDEX "LeadOpportunity_account_id_lead_status_created_at_idx"
ON "core"."LeadOpportunity"("account_id", "lead_status", "created_at");

CREATE INDEX "LeadOpportunity_account_id_converted_at_idx"
ON "core"."LeadOpportunity"("account_id", "converted_at");
