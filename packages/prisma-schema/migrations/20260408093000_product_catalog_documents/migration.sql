CREATE TYPE "core"."ProductCatalogDocumentStatus" AS ENUM ('IMPORTED', 'FAILED', 'ARCHIVED');

CREATE TABLE "core"."ProductCatalogDocument" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "mime_type" TEXT,
    "source_type" TEXT NOT NULL DEFAULT 'FILE',
    "file_size_bytes" INTEGER,
    "ai_core_document_id" TEXT,
    "ai_core_chunk_count" INTEGER,
    "preview_text" TEXT,
    "status" "core"."ProductCatalogDocumentStatus" NOT NULL DEFAULT 'IMPORTED',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductCatalogDocument_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "core"."ProductCatalogDocument"
    ADD CONSTRAINT "ProductCatalogDocument_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "core"."Account"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "core"."ProductCatalogDocument"
    ADD CONSTRAINT "ProductCatalogDocument_brand_id_fkey"
    FOREIGN KEY ("brand_id") REFERENCES "core"."Brand"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "ProductCatalogDocument_workspace_id_brand_id_status_idx"
    ON "core"."ProductCatalogDocument"("workspace_id", "brand_id", "status");

CREATE INDEX "ProductCatalogDocument_brand_id_created_at_idx"
    ON "core"."ProductCatalogDocument"("brand_id", "created_at");
