ALTER TABLE "core"."WorkspaceSubscription"
ADD COLUMN "billing_provider" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "stripe_customer_id" TEXT,
ADD COLUMN "stripe_subscription_id" TEXT,
ADD COLUMN "stripe_price_id" TEXT,
ADD COLUMN "stripe_product_id" TEXT;

CREATE UNIQUE INDEX "WorkspaceSubscription_stripe_customer_id_key"
  ON "core"."WorkspaceSubscription"("stripe_customer_id");

CREATE UNIQUE INDEX "WorkspaceSubscription_stripe_subscription_id_key"
  ON "core"."WorkspaceSubscription"("stripe_subscription_id");
