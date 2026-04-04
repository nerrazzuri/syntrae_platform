CREATE TABLE "core"."BrandPlatformConnection" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'MANUAL_SESSION',
    "status" TEXT NOT NULL DEFAULT 'DISCONNECTED',
    "session_path" TEXT,
    "session_updated_at" TIMESTAMP(3),
    "connected_at" TIMESTAMP(3),
    "last_checked_at" TIMESTAMP(3),
    "last_error" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandPlatformConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BrandPlatformConnection_brand_id_platform_key"
ON "core"."BrandPlatformConnection"("brand_id", "platform");

CREATE INDEX "BrandPlatformConnection_workspace_id_platform_status_idx"
ON "core"."BrandPlatformConnection"("workspace_id", "platform", "status");

ALTER TABLE "core"."BrandPlatformConnection"
ADD CONSTRAINT "BrandPlatformConnection_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "core"."Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "core"."BrandPlatformConnection"
ADD CONSTRAINT "BrandPlatformConnection_brand_id_fkey"
FOREIGN KEY ("brand_id") REFERENCES "core"."Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
