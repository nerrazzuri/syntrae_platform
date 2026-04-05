CREATE TABLE "core"."PromoVoucher" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "label" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "plan_code" TEXT NOT NULL,
  "billing_interval" TEXT NOT NULL DEFAULT 'MONTHLY',
  "duration_days" INTEGER NOT NULL,
  "max_redemptions" INTEGER,
  "redemptions_count" INTEGER NOT NULL DEFAULT 0,
  "starts_at" TIMESTAMP(3),
  "ends_at" TIMESTAMP(3),
  "last_redeemed_at" TIMESTAMP(3),
  "note" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_by_admin_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PromoVoucher_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PromoVoucher_code_key" ON "core"."PromoVoucher"("code");
CREATE INDEX "PromoVoucher_status_created_at_idx" ON "core"."PromoVoucher"("status", "created_at");
