
import { PrismaClient, AutomationPolicy, Prisma, PolicyStatus, PolicyMode } from '@syntrae/prisma-schema';

const prisma = new PrismaClient();

export class PolicyService {
    /**
     * Get the current ACTIVE policy for a brand.
     * If none exists, creates a default one.
     */
    static async getPolicy(brandId: string): Promise<AutomationPolicy> {
        const policy = await prisma.automationPolicy.findFirst({
            where: {
                brand_id: brandId,
                status: 'ACTIVE',
            },
            orderBy: { version: 'desc' },
        });

        if (!policy) {
            return this.createDefaultPolicy(brandId);
        }
        return policy;
    }

    /**
     * Get full history of policies for a brand.
     */
    static async getHistory(brandId: string): Promise<AutomationPolicy[]> {
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
            data: {
                brand_id: brandId,
                version: version,
                status: 'ACTIVE',
                mode: 'SAFE',
                enabled: true,
                // Default Safety Limits
                relevance_min_score: 70,
                intent_min_score: 60,
                max_videos_per_hour: 20,
                max_comments_per_video: 30,
                max_comments_per_hour: 200,
                max_leads_per_day: 30,
                cooldown_ms_between_actions: 2500,
                random_jitter_ms: 1500,
                quiet_hours: {}, // Disabled by default
                notes: "Auto-created default policy"
            },
        });
    }

    /**
     * Update policy by creating a new version.
     * Handles status transitions (ensure only 1 ACTIVE).
     */
    static async updatePolicy(brandId: string, updates: Partial<AutomationPolicy>, userId?: string): Promise<AutomationPolicy> {
        return prisma.$transaction(async (tx) => {
            // 1. Fetch current latest to get version
            const current = await tx.automationPolicy.findFirst({
                where: { brand_id: brandId },
                orderBy: { version: 'desc' }
            });
            const newVersion = (current?.version || 0) + 1;

            // 2. If new status is ACTIVE, archive old active
            if (updates.status === 'ACTIVE') {
                await tx.automationPolicy.updateMany({
                    where: { brand_id: brandId, status: 'ACTIVE' },
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
                cooldown_ms_between_actions: 2500,
                random_jitter_ms: 1500,
                allow_capture_seen_events: true,
                platform_limits: {},
                quiet_hours: {},
                notes: ""
            };

            // Filter out system fields from base
            const { id, created_at, updated_at, version, status, ...cleanBase } = base as any;

            const payload = {
                ...cleanBase,
                ...updates,
                brand_id: brandId,
                version: newVersion,
                created_by: userId
                // status is in updates or default DRAFT if not specified? 
                // If caller wants to activate immediately, they send status=ACTIVE
            };

            // Validate Bounds
            if (payload.relevance_min_score < 0 || payload.relevance_min_score > 100) throw new Error("Score must be 0-100");
            if (payload.max_videos_per_hour > 500) throw new Error("Max videos/hr limit exceeded (500)");

            return tx.automationPolicy.create({
                data: payload
            });
        });
    }
}
