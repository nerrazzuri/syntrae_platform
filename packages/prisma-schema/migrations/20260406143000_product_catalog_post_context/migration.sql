DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'ProductCatalogStatus'
          AND n.nspname = 'core'
    ) THEN
        CREATE TYPE "core"."ProductCatalogStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "core"."ProductCatalogItem" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT NOT NULL,
    "price_label" TEXT,
    "target_buyer" TEXT,
    "key_benefits" JSONB NOT NULL DEFAULT '[]',
    "common_objections" JSONB NOT NULL DEFAULT '[]',
    "cta_url" TEXT,
    "cta_label" TEXT,
    "availability_status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "forbidden_claims" JSONB NOT NULL DEFAULT '[]',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" "core"."ProductCatalogStatus" NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCatalogItem_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ProductCatalogItem_workspace_id_fkey'
    ) THEN
        ALTER TABLE "core"."ProductCatalogItem"
            ADD CONSTRAINT "ProductCatalogItem_workspace_id_fkey"
            FOREIGN KEY ("workspace_id") REFERENCES "core"."Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ProductCatalogItem_brand_id_fkey'
    ) THEN
        ALTER TABLE "core"."ProductCatalogItem"
            ADD CONSTRAINT "ProductCatalogItem_brand_id_fkey"
            FOREIGN KEY ("brand_id") REFERENCES "core"."Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ProductCatalogItem_workspace_id_brand_id_status_idx"
    ON "core"."ProductCatalogItem"("workspace_id", "brand_id", "status");

CREATE INDEX IF NOT EXISTS "ProductCatalogItem_brand_id_priority_idx"
    ON "core"."ProductCatalogItem"("brand_id", "priority");

ALTER TABLE "core"."EngagementEvent"
    ADD COLUMN IF NOT EXISTS "source_post_caption" TEXT,
    ADD COLUMN IF NOT EXISTS "source_post_hashtags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN IF NOT EXISTS "source_post_url" TEXT,
    ADD COLUMN IF NOT EXISTS "source_post_author_name" TEXT,
    ADD COLUMN IF NOT EXISTS "source_post_search_keyword" TEXT;

ALTER TABLE "core"."LeadOpportunity"
    ADD COLUMN IF NOT EXISTS "matched_catalog_item_id" TEXT,
    ADD COLUMN IF NOT EXISTS "matched_catalog_item_name" TEXT,
    ADD COLUMN IF NOT EXISTS "catalog_match_score" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "catalog_match_reasons" JSONB;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'LeadOpportunity_matched_catalog_item_id_fkey'
    ) THEN
        ALTER TABLE "core"."LeadOpportunity"
            ADD CONSTRAINT "LeadOpportunity_matched_catalog_item_id_fkey"
            FOREIGN KEY ("matched_catalog_item_id") REFERENCES "core"."ProductCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

ALTER TABLE "core"."DiscoveredVideo"
    ADD COLUMN IF NOT EXISTS "caption" TEXT,
    ADD COLUMN IF NOT EXISTS "hashtags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN IF NOT EXISTS "search_keyword" TEXT,
    ADD COLUMN IF NOT EXISTS "source_post_author_name" TEXT;
