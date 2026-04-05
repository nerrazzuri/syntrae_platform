
import { PrismaClient, AutomationPolicy, Prisma, PolicyStatus, PolicyMode } from '@syntrae/prisma-schema';
import { BrandDefaultsService } from './brand_defaults.service';

const prisma = new PrismaClient();

export class PolicyService {
    private static async getLatestCurrentPolicy(brandId: string) {
        return prisma.automationPolicy.findFirst({
            where: {
                brand_id: brandId,
                status: { not: 'ARCHIVED' }
            },
            orderBy: { version: 'desc' }
        });
    }

    static async assertBrandAccess(brandId: string, workspaceId: string) {
        const brand = await prisma.brand.findFirst({
            where: { id: brandId, workspace_id: workspaceId },
            select: { id: true }
        });

        if (!brand) {
            throw new Error('Brand not found or access denied');
        }

        return brand;
    }

    static async assertInstallAccess(brandId: string, installId: string) {
        const install = await prisma.installRegistry.findFirst({
            where: {
                install_id: installId,
                is_active: true,
                account: {
                    brands: {
                        some: { id: brandId }
                    }
                }
            },
            select: { id: true }
        });

        if (!install) {
            throw new Error('Install not authorized for brand');
        }

        return install;
    }

    /**
     * Get the current ACTIVE policy for a brand.
     * If none exists, creates a default one.
     */
    static async getPolicy(brandId: string, workspaceId?: string, installId?: string): Promise<AutomationPolicy> {
        if (workspaceId) {
            await this.assertBrandAccess(brandId, workspaceId);
        } else if (installId) {
            await this.assertInstallAccess(brandId, installId);
        } else {
            throw new Error('Brand access context required');
        }

        const policy = await this.getLatestCurrentPolicy(brandId);

        if (!policy) {
            return this.createDefaultPolicy(brandId);
        }
        return policy;
    }

    /**
     * Get full history of policies for a brand.
     */
    static async getHistory(brandId: string, workspaceId: string): Promise<AutomationPolicy[]> {
        await this.assertBrandAccess(brandId, workspaceId);
        return prisma.automationPolicy.findMany({
            where: { brand_id: brandId },
            orderBy: { version: 'desc' }
        });
    }

    /**
     * Create a default SAFE policy.
     */
    static async createDefaultPolicy(brandId: string): Promise<AutomationPolicy> {
        // Check highest version to increment safely
        const latest = await prisma.automationPolicy.findFirst({
            where: { brand_id: brandId },
            orderBy: { version: 'desc' }
        });
        const version = (latest?.version || 0) + 1;

        return prisma.automationPolicy.create({
            data: BrandDefaultsService.buildDefaultPolicyInput(brandId, version),
        });
    }

    /**
     * Update policy by creating a new version.
     * Handles status transitions (ensure only 1 ACTIVE).
     */
    static async updatePolicy(brandId: string, workspaceId: string, updates: Partial<AutomationPolicy>, userId?: string): Promise<AutomationPolicy> {
        await this.assertBrandAccess(brandId, workspaceId);
        return prisma.$transaction(async (tx) => {
            // 1. Fetch current latest to get version
            const current = await tx.automationPolicy.findFirst({
                where: { brand_id: brandId },
                orderBy: { version: 'desc' }
            });
            const newVersion = (current?.version || 0) + 1;

            // 2. Supersede the previous current policy version.
            if (updates.status) {
                await tx.automationPolicy.updateMany({
                    where: { brand_id: brandId, status: { not: 'ARCHIVED' } },
                    data: { status: 'ARCHIVED' }
                });
            }

            // 3. Create new policy version
            // We copy fields from current if not provided, or default
            // Actually best is to copy everything from current and apply updates
            // BUT current might differ if we are updating from a specific base. 
            // For simplicity, we assume we want to clone 'current' + updates.

            // If no current, we treat as fresh create
            const base = current || {
                brand_id: brandId,
                mode: 'SAFE',
                enabled: true,
                relevance_min_score: 70,
                intent_min_score: 60,
                max_videos_per_hour: 20,
                max_comments_per_video: 30,
                max_comments_per_hour: 200,
                max_leads_per_day: 30,
                max_source_posts_per_run: 60,
                max_comments_per_source_post: 10,
                cooldown_ms_between_actions: 2500,
                random_jitter_ms: 1500,
                allow_capture_seen_events: true,
                platform_limits: {},
                quiet_hours: {},
                notes: ""
            };

            // Filter out system fields from base
            const { id, created_at, updated_at, version, status, ...cleanBase } = base as any;

            const maxSourcePostsPerRun = updates.max_source_posts_per_run ?? cleanBase.max_source_posts_per_run;
            const maxCommentsPerSourcePost = updates.max_comments_per_source_post ?? cleanBase.max_comments_per_source_post;

            const sanitizedUpdates: Partial<AutomationPolicy> = {
                status: updates.status ?? current?.status ?? PolicyStatus.ACTIVE,
                mode: updates.mode ?? cleanBase.mode,
                enabled: updates.enabled ?? cleanBase.enabled,
                relevance_min_score: updates.relevance_min_score ?? cleanBase.relevance_min_score,
                intent_min_score: updates.intent_min_score ?? cleanBase.intent_min_score,
                allow_capture_seen_events: updates.allow_capture_seen_events ?? cleanBase.allow_capture_seen_events,
                max_source_posts_per_run: maxSourcePostsPerRun,
                max_comments_per_source_post: maxCommentsPerSourcePost,
                max_videos_per_hour: maxSourcePostsPerRun,
                max_comments_per_video: maxCommentsPerSourcePost,
                max_comments_per_hour: maxSourcePostsPerRun * maxCommentsPerSourcePost,
                max_leads_per_day: updates.max_leads_per_day ?? cleanBase.max_leads_per_day,
                cooldown_ms_between_actions: updates.cooldown_ms_between_actions ?? cleanBase.cooldown_ms_between_actions,
                notes: updates.notes ?? cleanBase.notes
            };

            const payload = {
                ...cleanBase,
                ...sanitizedUpdates,
                brand_id: brandId,
                version: newVersion,
                created_by: userId
            };

            // Validate Bounds
            if (payload.relevance_min_score < 0 || payload.relevance_min_score > 100) throw new Error("Score must be 0-100");
            if (payload.intent_min_score < 0 || payload.intent_min_score > 100) throw new Error("Score must be 0-100");
            if (payload.max_source_posts_per_run < 1 || payload.max_source_posts_per_run > 60) throw new Error("Max videos/run must be between 1 and 60");
            if (payload.max_comments_per_source_post < 1 || payload.max_comments_per_source_post > 10) throw new Error("Max comments/video must be between 1 and 10");
            if (payload.cooldown_ms_between_actions < 0) throw new Error("Action pacing must be 0 or greater");

            return tx.automationPolicy.create({
                data: payload
            });
        });
    }
}
