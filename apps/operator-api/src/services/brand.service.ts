import { promises as fs } from 'fs';
import path from 'path';
import { Prisma, prisma } from '../db';
import { SubscriptionPolicyService } from './billing/subscription_policy.service';
import { BrandDefaultsService } from './brand_defaults.service';

function storageRoot() {
    return process.env.AUTOMATION_STORAGE_ROOT || '/data/storage';
}

async function removeBrandStorageArtifacts(workspaceId: string, brandId: string) {
    await Promise.all([
        fs.rm(path.join(storageRoot(), 'sessions', workspaceId, brandId), { recursive: true, force: true }),
        fs.rm(path.join(storageRoot(), 'sessions', brandId), { recursive: true, force: true }),
    ]);
}

export class BrandService {
    static async createBrand(accountId: string, name: string, domain: string) {
        await SubscriptionPolicyService.assertCanCreateAdditionalBrand(accountId);

        return prisma.$transaction(async (tx) => {
            const brand = await tx.brand.create({
                data: {
                    workspace_id: accountId,
                    name,
                    domain,
                    domain_context: {},
                    status: 'ACTIVE'
                }
            });

            await tx.automationPolicy.create({
                data: BrandDefaultsService.buildDefaultPolicyInput(brand.id, 1)
            });

            await tx.marketProfile.create({
                data: BrandDefaultsService.buildDefaultMarketProfileInput(brand.id, brand.name, brand.domain)
            });

            return brand;
        });
    }

    static async listBrands(accountId: string) {
        const brands = await prisma.brand.findMany({
            where: { workspace_id: accountId },
            orderBy: { created_at: 'desc' },
            include: {
                platform_connections: {
                    where: { platform: 'rednote' },
                    orderBy: { updated_at: 'desc' },
                    take: 1,
                    select: {
                        id: true,
                        platform: true,
                        status: true,
                        last_verified_at: true,
                        updated_at: true,
                    }
                }
            }
        });

        return brands.map((brand) => ({
            ...brand,
            xhs_connection: brand.platform_connections[0] ?? null,
        }));
    }

    static async setBrandStatus(accountId: string, brandId: string, status: 'ACTIVE' | 'PAUSED') {
        // Verify ownership
        const brand = await prisma.brand.findFirst({
            where: { id: brandId, workspace_id: accountId }
        });

        if (!brand) throw new Error('Brand not found or access denied');

        // Activation must respect the effective package's active-brand ceiling.
        // A downgraded workspace can retain paused brands, but cannot activate
        // more brands than its current package allows.

        // Check Account Status
        const account = await prisma.account.findUnique({
            where: { id: accountId },
            select: { status: true }
        });

        if (status === 'ACTIVE') {
            if (account?.status === 'PENDING_DOWNGRADE') {
                throw new Error('Cannot activate brands while account is pending downgrade. Please resolve the downgrade first.');
            }

            const { plan } = await SubscriptionPolicyService.getEffectivePlan(accountId);
            const activeCount = await prisma.brand.count({
                where: { workspace_id: accountId, status: 'ACTIVE', id: { not: brandId } }
            });

            if (activeCount >= plan.limits.maxBrands) {
                throw new Error(`Cannot activate brand: Plan limit of ${plan.limits.maxBrands} active brands reached.`);
            }
        }

        return prisma.brand.update({
            where: { id: brandId },
            data: { status }
        });
    }

    static async updateBrandBasics(accountId: string, brandId: string, updates: { name?: string; domain?: string }) {
        const brand = await prisma.brand.findFirst({
            where: { id: brandId, workspace_id: accountId }
        });

        if (!brand) throw new Error('Brand not found or access denied');

        const data: Record<string, unknown> = {};
        if (typeof updates.name === 'string' && updates.name.trim()) {
            data.name = updates.name.trim();
        }
        if (typeof updates.domain === 'string' && updates.domain.trim()) {
            data.domain = updates.domain.trim();
        }

        if (Object.keys(data).length === 0) {
            throw new Error('No brand updates provided');
        }

        return prisma.brand.update({
            where: { id: brandId },
            data,
        });
    }

    static async deleteBrand(accountId: string, brandId: string) {
        const brand = await prisma.brand.findFirst({
            where: { id: brandId, workspace_id: accountId }
        });

        if (!brand) throw new Error('Brand not found or access denied');

        const deletedBrand = await prisma.$transaction(async (tx) => {
            const deletedCounts: Record<string, number> = {};

            deletedCounts.feedback_signals = await tx.$executeRaw(Prisma.sql`
                DELETE FROM "core"."FeedbackSignal"
                WHERE "session_id" IN (
                    SELECT "SuggestionSession"."id"
                    FROM "core"."SuggestionSession"
                    INNER JOIN "core"."EngagementEvent"
                        ON "EngagementEvent"."id" = "SuggestionSession"."event_id"
                    WHERE "EngagementEvent"."brand_id" = ${brandId}
                )
            `);

            deletedCounts.suggestion_decisions = await tx.$executeRaw(Prisma.sql`
                DELETE FROM "core"."SuggestionDecision"
                WHERE "suggestion_id" IN (
                    SELECT "Suggestion"."id"
                    FROM "core"."Suggestion"
                    INNER JOIN "core"."EngagementEvent"
                        ON "EngagementEvent"."id" = "Suggestion"."event_id"
                    WHERE "EngagementEvent"."brand_id" = ${brandId}
                )
            `);

            deletedCounts.suggestions = await tx.$executeRaw(Prisma.sql`
                DELETE FROM "core"."Suggestion"
                WHERE "event_id" IN (
                    SELECT "id"
                    FROM "core"."EngagementEvent"
                    WHERE "brand_id" = ${brandId}
                )
            `);

            deletedCounts.suggestion_sessions = await tx.$executeRaw(Prisma.sql`
                DELETE FROM "core"."SuggestionSession"
                WHERE "event_id" IN (
                    SELECT "id"
                    FROM "core"."EngagementEvent"
                    WHERE "brand_id" = ${brandId}
                )
            `);

            const manualSendEvents = await tx.manualSendEvent.deleteMany({ where: { brand_id: brandId } });
            deletedCounts.manual_send_events = manualSendEvents.count;

            const outreachDrafts = await tx.outreachDraft.deleteMany({ where: { brand_id: brandId } });
            deletedCounts.outreach_drafts = outreachDrafts.count;

            const leads = await tx.leadOpportunity.deleteMany({ where: { brand_id: brandId } });
            deletedCounts.leads = leads.count;

            const engagementEvents = await tx.engagementEvent.deleteMany({ where: { brand_id: brandId } });
            deletedCounts.engagement_events = engagementEvents.count;

            const discoveredVideos = await tx.discoveredVideo.deleteMany({ where: { brand_id: brandId } });
            deletedCounts.discovered_videos = discoveredVideos.count;

            const automationRuns = await tx.automationRun.deleteMany({ where: { brand_id: brandId } });
            deletedCounts.automation_runs = automationRuns.count;

            const automationPolicies = await tx.automationPolicy.deleteMany({ where: { brand_id: brandId } });
            deletedCounts.automation_policies = automationPolicies.count;

            const marketProfiles = await tx.marketProfile.deleteMany({ where: { brand_id: brandId } });
            deletedCounts.market_profiles = marketProfiles.count;

            const catalogDocuments = await tx.productCatalogDocument.deleteMany({ where: { brand_id: brandId } });
            deletedCounts.product_catalog_documents = catalogDocuments.count;

            const catalogItems = await tx.productCatalogItem.deleteMany({ where: { brand_id: brandId } });
            deletedCounts.product_catalog_items = catalogItems.count;

            const usageCounters = await tx.workspaceUsageCounter.deleteMany({ where: { brand_id: brandId } });
            deletedCounts.workspace_usage_counters = usageCounters.count;

            const platformConnectionChallenges = await tx.platformConnectionChallenge.deleteMany({ where: { brand_id: brandId } });
            deletedCounts.platform_connection_challenges = platformConnectionChallenges.count;

            const platformConnections = await tx.brandPlatformConnection.deleteMany({ where: { brand_id: brandId } });
            deletedCounts.platform_connections = platformConnections.count;

            const deletedBrandRecord = await tx.brand.delete({ where: { id: brandId } });

            return {
                ...deletedBrandRecord,
                deleted_counts: deletedCounts,
            };
        });

        try {
            await removeBrandStorageArtifacts(accountId, brandId);
        } catch (err: any) {
            console.warn('[Brands] Failed to remove brand storage artifacts:', err?.message || err);
        }

        return deletedBrand;
    }
}
