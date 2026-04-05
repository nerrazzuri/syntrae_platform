UPDATE "core"."LeadOpportunity"
SET "lead_status" = 'NEW'::"core"."LeadStatus"
WHERE "lead_status" = 'QUALIFIED'::"core"."LeadStatus"
  AND "followed_up_at" IS NULL
  AND "converted_at" IS NULL
  AND "deal_value" IS NULL
  AND ("outcome_reason" IS NULL OR btrim("outcome_reason") = '')
  AND "outcome_source" = 'MANUAL'::"core"."OutcomeSource";
