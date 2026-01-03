-- CreateEnum
CREATE TYPE "core"."VideoDiscoveryDecision" AS ENUM ('ACCEPT', 'REJECT', 'SKIP');

-- CreateTable
CREATE TABLE "core"."DiscoveredVideo" (
    "id" TEXT NOT NULL,
    "automation_run_id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "video_id" TEXT NOT NULL,
    "video_url" TEXT NOT NULL,
    "market_profile_id" TEXT,
    "market_profile_version" INTEGER,
    "market_score" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "decision" "core"."VideoDiscoveryDecision" NOT NULL,
    "decision_reasons" TEXT[],
    "discovered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveredVideo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscoveredVideo_automation_run_id_idx" ON "core"."DiscoveredVideo"("automation_run_id");

-- CreateIndex
CREATE INDEX "DiscoveredVideo_brand_id_discovered_at_idx" ON "core"."DiscoveredVideo"("brand_id", "discovered_at");

-- AddForeignKey
ALTER TABLE "core"."DiscoveredVideo" ADD CONSTRAINT "DiscoveredVideo_automation_run_id_fkey" FOREIGN KEY ("automation_run_id") REFERENCES "core"."AutomationRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."DiscoveredVideo" ADD CONSTRAINT "DiscoveredVideo_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "core"."Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
