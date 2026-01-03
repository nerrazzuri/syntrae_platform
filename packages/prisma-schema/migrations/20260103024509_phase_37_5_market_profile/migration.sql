-- CreateEnum
CREATE TYPE "core"."MarketCategory" AS ENUM ('SKINCARE', 'BEAUTY', 'FITNESS', 'SAAS', 'EDUCATION', 'LOCAL_SERVICE', 'ECOM_GENERAL');

-- CreateEnum
CREATE TYPE "core"."MarketDecision" AS ENUM ('ACCEPT', 'REJECT', 'SKIP');

-- CreateEnum
CREATE TYPE "core"."MarketSkipReason" AS ENUM ('LOW_SCORE', 'AMBIGUOUS', 'LANGUAGE_MISMATCH', 'INSUFFICIENT_SIGNALS');

-- CreateEnum
CREATE TYPE "core"."DiscoveryIntent" AS ENUM ('CONSERVATIVE', 'BALANCED', 'AGGRESSIVE');

-- CreateEnum
CREATE TYPE "core"."MarketProfileStatus" AS ENUM ('DRAFT', 'READY', 'ACTIVE');

-- CreateEnum
CREATE TYPE "core"."DiscoveryMode" AS ENUM ('MANUAL_URL', 'FEED_SCROLL', 'SEARCH_QUERY');

-- AlterEnum
ALTER TYPE "core"."RunStatus" ADD VALUE 'PENDING';

-- DropForeignKey
ALTER TABLE "core"."AutomationRun" DROP CONSTRAINT "AutomationRun_policy_id_fkey";

-- AlterTable
ALTER TABLE "core"."AutomationRun" ADD COLUMN     "discovery_intent" "core"."DiscoveryIntent" NOT NULL DEFAULT 'BALANCED',
ADD COLUMN     "discovery_mode" "core"."DiscoveryMode" NOT NULL DEFAULT 'MANUAL_URL',
ALTER COLUMN "policy_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "core"."LeadOpportunity" ADD COLUMN     "market_match_reasons" JSONB,
ADD COLUMN     "market_match_score" DOUBLE PRECISION,
ADD COLUMN     "market_profile_id" TEXT,
ADD COLUMN     "market_profile_version" INTEGER;

-- CreateTable
CREATE TABLE "core"."MarketProfile" (
    "id" TEXT NOT NULL,
    "brand_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "core"."MarketProfileStatus" NOT NULL DEFAULT 'DRAFT',
    "primary_category" "core"."MarketCategory" NOT NULL,
    "target_audience" TEXT NOT NULL,
    "languages" TEXT[],
    "keywords_positive" TEXT[],
    "keywords_negative" TEXT[],
    "hashtags_positive" TEXT[],
    "hashtags_negative" TEXT[],
    "excluded_topics" TEXT[],
    "acceptance_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
    "weight_keyword" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "weight_hashtag" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
    "quality_score" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "validation_warnings" TEXT[],
    "discovery_intent" "core"."DiscoveryIntent" NOT NULL DEFAULT 'BALANCED',
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketProfile_brand_id_is_active_idx" ON "core"."MarketProfile"("brand_id", "is_active");

-- AddForeignKey
ALTER TABLE "core"."AutomationRun" ADD CONSTRAINT "AutomationRun_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "core"."AutomationPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "core"."MarketProfile" ADD CONSTRAINT "MarketProfile_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "core"."Brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
