-- AlterEnum
ALTER TYPE "core"."RunStatus" ADD VALUE 'DEGRADED';

-- AlterEnum
ALTER TYPE "core"."VideoDiscoveryDecision" ADD VALUE 'ERROR';

-- AlterTable
ALTER TABLE "core"."DiscoveredVideo" ADD COLUMN     "error_class" TEXT,
ADD COLUMN     "evaluation_performed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "http_status" INTEGER;
