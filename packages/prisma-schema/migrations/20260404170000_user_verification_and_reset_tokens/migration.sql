ALTER TABLE "core"."User"
ADD COLUMN "email_verified_at" TIMESTAMP(3),
ADD COLUMN "verification_email_sent_at" TIMESTAMP(3);

CREATE TABLE "core"."UserActionToken" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "token_type" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "UserActionToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserActionToken_token_hash_key"
  ON "core"."UserActionToken"("token_hash");

CREATE INDEX "UserActionToken_user_id_token_type_expires_at_idx"
  ON "core"."UserActionToken"("user_id", "token_type", "expires_at");

ALTER TABLE "core"."UserActionToken"
ADD CONSTRAINT "UserActionToken_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "core"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
