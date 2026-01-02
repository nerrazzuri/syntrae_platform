import { prisma } from '../db';

export interface LeadFilters {
    buyer_stage?: 'AWARENESS' | 'EVALUATING' | 'READY';
    recommended_action?: 'SILENT_CAPTURE' | 'RECOMMEND_DM' | 'PRIORITY_DM';
    min_confidence?: number;
    platform?: string;
    brand_id?: string; // Phase 37.4
    created_after?: string;
    created_before?: string;
}

export class LeadService {
    static async listLeads(
        accountId: string,
        filters: LeadFilters,
        limit: number = 50,
        offset: number = 0
    ) {
        const where: any = {
            account_id: accountId, // Strict Scoping
        };

        if (filters.brand_id) where.brand_id = filters.brand_id;
        if (filters.buyer_stage) where.buyer_stage = filters.buyer_stage;
        if (filters.recommended_action) where.recommended_action = filters.recommended_action;
        if (filters.platform) where.platform = filters.platform;

        if (filters.min_confidence) {
            where.confidence = { gte: filters.min_confidence };
        }

        if (filters.created_after || filters.created_before) {
            where.created_at = {};
            if (filters.created_after) where.created_at.gte = new Date(filters.created_after);
            if (filters.created_before) where.created_at.lte = new Date(filters.created_before);
        }

        // Parallel fetch for count and data
        const [total, items] = await Promise.all([
            prisma.leadOpportunity.count({ where }),
            prisma.leadOpportunity.findMany({
                where,
                take: Math.min(limit, 200), // Hard cap
                skip: offset,
                orderBy: { created_at: 'desc' },
                select: {
                    id: true,
                    platform: true,
                    video_id: true,
                    comment_id: true,
                    user_handle: true,
                    user_profile_url: true,
                    intent: true,
                    buyer_stage: true,
                    confidence: true,
                    recommended_action: true,
                    urgency_score: true,
                    risk_level: true,
                    created_at: true,
                    // Exclude internal metadata/preferences for list view
                }
            })
        ]);

        return { items, total, limit, offset };
    }

    static async getLead(accountId: string, leadId: string) {
        const lead = await prisma.leadOpportunity.findFirst({
            where: {
                id: leadId,
                account_id: accountId // Strict Scoping
            }
        });
        return lead;
    }

    /**
     * Returns a query object/promise that can be streamed, or just fetches all (capped).
     * For simplicity in this phase without stream-json deps, we'll fetch batched or just simple limit.
     * Plan says "Stream response". We can stream via Prisma cursor if needed, or just fetch all if < 5000.
     * Let's fetch up to 5000 for export.
     */
    static async exportLeads(accountId: string, filters: LeadFilters) {
        const where: any = {
            account_id: accountId,
        };

        if (filters.brand_id) where.brand_id = filters.brand_id;
        if (filters.buyer_stage) where.buyer_stage = filters.buyer_stage;
        if (filters.recommended_action) where.recommended_action = filters.recommended_action;
        if (filters.platform) where.platform = filters.platform;
        if (filters.min_confidence) where.confidence = { gte: filters.min_confidence };

        // No date filters for export in basic req requirements, but good to have? 
        // Plan says "Same filters as /api/leads"
        if (filters.created_after || filters.created_before) {
            where.created_at = {};
            if (filters.created_after) where.created_at.gte = new Date(filters.created_after);
            if (filters.created_before) where.created_at.lte = new Date(filters.created_before);
        }

        // Fetch all (capped 5000)
        return prisma.leadOpportunity.findMany({
            where,
            take: 5000,
            orderBy: { created_at: 'desc' }
        });
    }

    static async requestDraft(accountId: string, leadId: string, force: boolean = false) {
        const lead = await prisma.leadOpportunity.findFirst({
            where: { id: leadId, account_id: accountId }
        });
        if (!lead) throw new Error("Lead not found or access denied");

        const PROMPT_VERSION = 'v1';

        // 1. Idempotency Check (Operator Logic)
        if (!force) {
            // Fetch drafts for this lead
            // @ts-ignore
            const drafts = await (prisma as any).outreachDraft.findMany({
                where: { lead_id: leadId }
            });

            // Filter in-memory for safety against Prisma version/JSON filter quirks in this env
            const validDraft = drafts.find((d: any) => d.generation_meta?.prompt_version === PROMPT_VERSION);
            if (validDraft) {
                return validDraft;
            }
        }

        // 2. Call AI Core (Pure Generation)
        const aiCoreUrl = process.env.AI_CORE_BASE_URL || 'http://ai-core:8000';
        const secret = process.env.AI_CORE_INTERNAL_SECRET;
        const ownerSettings = {};

        // @ts-ignore
        const response = await fetch(`${aiCoreUrl}/v1/internal/drafts/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Internal-Secret': secret || '',
                'X-Account-Id': accountId, // Enforce Scope
            },
            body: JSON.stringify({
                lead_id: leadId,
                account_id: accountId,
                force: force, // passed but might be ignored by service
                owner_settings: ownerSettings
            })
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(`AI Core error: ${response.status} ${err}`);
        }

        const result = await response.json();

        // 3. Persist
        return (prisma as any).outreachDraft.create({
            data: {
                brand_id: lead.brand_id,
                lead_id: leadId,
                account_id: accountId,
                platform: lead.platform,
                buyer_stage: lead.buyer_stage,
                draft_text: result.draft_text,
                tone: result.tone || 'professional',
                language: result.language || 'English',
                generation_meta: {
                    prompt_version: result.prompt_version,
                    model: result.model,
                    latency: result.latency
                }
            }
        });
    }
}
