-- DropForeignKey
ALTER TABLE "core"."api_keys" DROP CONSTRAINT "api_keys_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "core"."approvals" DROP CONSTRAINT "approvals_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "core"."archive_registry" DROP CONSTRAINT "archive_registry_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "core"."audit_log" DROP CONSTRAINT "audit_log_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "core"."compliance_reports" DROP CONSTRAINT "compliance_reports_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "core"."conversation_memory" DROP CONSTRAINT "conversation_memory_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "core"."conversations" DROP CONSTRAINT "conversations_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "core"."conversations" DROP CONSTRAINT "conversations_user_id_fkey";

-- DropForeignKey
ALTER TABLE "core"."cost_summaries" DROP CONSTRAINT "cost_summaries_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "core"."documents" DROP CONSTRAINT "documents_knowledge_base_id_fkey";

-- DropForeignKey
ALTER TABLE "core"."eval_runs" DROP CONSTRAINT "eval_runs_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "core"."feedback_events" DROP CONSTRAINT "feedback_events_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "core"."knowledge_bases" DROP CONSTRAINT "knowledge_bases_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "core"."knowledge_chunks" DROP CONSTRAINT "knowledge_chunks_document_id_fkey";

-- DropForeignKey
ALTER TABLE "core"."messages" DROP CONSTRAINT "messages_conversation_id_fkey";

-- DropForeignKey
ALTER TABLE "core"."retention_policies" DROP CONSTRAINT "retention_policies_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "core"."tenant_rerank_config" DROP CONSTRAINT "tenant_rerank_config_tenant_id_fkey";

-- DropForeignKey
ALTER TABLE "core"."users" DROP CONSTRAINT "users_tenant_id_fkey";

-- AlterTable
ALTER TABLE "core"."EngagementEvent" ADD COLUMN     "brand_id" TEXT;

-- AlterTable
ALTER TABLE "core"."LeadOpportunity" ADD COLUMN     "brand_id" TEXT;

-- AlterTable
ALTER TABLE "core"."OutreachDraft" ADD COLUMN     "brand_id" TEXT;

-- DropTable
DROP TABLE "core"."api_keys";

-- DropTable
DROP TABLE "core"."approvals";

-- DropTable
DROP TABLE "core"."archive_registry";

-- DropTable
DROP TABLE "core"."audit_log";

-- DropTable
DROP TABLE "core"."compliance_reports";

-- DropTable
DROP TABLE "core"."connector_sync_records";

-- DropTable
DROP TABLE "core"."conversation_memory";

-- DropTable
DROP TABLE "core"."conversations";

-- DropTable
DROP TABLE "core"."cost_summaries";

-- DropTable
DROP TABLE "core"."documents";

-- DropTable
DROP TABLE "core"."eval_runs";

-- DropTable
DROP TABLE "core"."feedback_events";

-- DropTable
DROP TABLE "core"."knowledge_bases";

-- DropTable
DROP TABLE "core"."knowledge_chunks";

-- DropTable
DROP TABLE "core"."messages";

-- DropTable
DROP TABLE "core"."retention_policies";

-- DropTable
DROP TABLE "core"."tenant_actions";

-- DropTable
DROP TABLE "core"."tenant_connectors";

-- DropTable
DROP TABLE "core"."tenant_migrations";

-- DropTable
DROP TABLE "core"."tenant_rerank_config";

-- DropTable
DROP TABLE "core"."tenants";

-- DropTable
DROP TABLE "core"."users";

-- CreateTable
CREATE TABLE "core"."Brand" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "domain_context" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Brand_workspace_id_idx" ON "core"."Brand"("workspace_id");

-- CreateIndex
CREATE INDEX "EngagementEvent_brand_id_idx" ON "core"."EngagementEvent"("brand_id");

-- CreateIndex
CREATE INDEX "LeadOpportunity_brand_id_idx" ON "core"."LeadOpportunity"("brand_id");

-- CreateIndex
CREATE INDEX "OutreachDraft_brand_id_idx" ON "core"."OutreachDraft"("brand_id");

-- AddForeignKey
ALTER TABLE "core"."Brand" ADD CONSTRAINT "Brand_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "core"."Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."EngagementEvent" ADD CONSTRAINT "EngagementEvent_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "core"."Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."LeadOpportunity" ADD CONSTRAINT "LeadOpportunity_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "core"."Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."OutreachDraft" ADD CONSTRAINT "OutreachDraft_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "core"."Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

