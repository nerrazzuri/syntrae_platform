ALTER TABLE "core"."BrandPlatformConnection"
ADD COLUMN "auth_type" TEXT NOT NULL DEFAULT 'MANUAL_SESSION_FILE',
ADD COLUMN "encrypted_session_payload" TEXT,
ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "last_verified_at" TIMESTAMP(3),
ADD COLUMN "verification_error" TEXT,
ADD COLUMN "expires_at" TIMESTAMP(3);

CREATE TABLE "core"."PlatformConnectionChallenge" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "brand_id" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "nonce_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "created_by_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformConnectionChallenge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlatformConnectionChallenge_workspace_brand_platform_idx"
  ON "core"."PlatformConnectionChallenge"("workspace_id", "brand_id", "platform");

CREATE INDEX "PlatformConnectionChallenge_expires_used_idx"
  ON "core"."PlatformConnectionChallenge"("expires_at", "used_at");

ALTER TABLE "core"."PlatformConnectionChallenge"
ADD CONSTRAINT "PlatformConnectionChallenge_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "core"."Account"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "core"."PlatformConnectionChallenge"
ADD CONSTRAINT "PlatformConnectionChallenge_brand_id_fkey"
FOREIGN KEY ("brand_id") REFERENCES "core"."Brand"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "core"."PlatformConnectionChallenge"
ADD CONSTRAINT "PlatformConnectionChallenge_created_by_user_id_fkey"
FOREIGN KEY ("created_by_user_id") REFERENCES "core"."User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
