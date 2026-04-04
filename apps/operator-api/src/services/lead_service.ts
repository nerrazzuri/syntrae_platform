import { prisma } from '../db';
import { OwnerSettingsService } from './owner/owner_settings_service';

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
        const [total, rawItems] = await Promise.all([
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
                    source_event_id: true,
                    created_at: true,
                    event: {
                        select: {
                            content_text: true
                        }
                    },
                    // Exclude internal metadata/preferences for list view
                }
            })
        ]);

        const items = rawItems.map(({ event, ...lead }) => ({
            ...lead,
            original_comment: event?.content_text || null
        }));

        return { items, total, limit, offset };
    }

    static async getLead(accountId: string, leadId: string) {
        const lead = await prisma.leadOpportunity.findFirst({
            where: {
                id: leadId,
                account_id: accountId // Strict Scoping
            },
            include: {
                event: {
                    select: {
                        content_text: true
                    }
                }
            }
        });

        if (!lead) {
            return lead;
        }

        const { event, ...rest } = lead;
        return {
            ...rest,
            original_comment: event?.content_text || null
        };
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
            orderBy: { created_at: 'desc' },
            select: {
                platform: true,
                buyer_stage: true,
                intent: true,
                confidence: true,
                recommended_action: true,
                urgency_score: true,
                user_handle: true,
                user_profile_url: true,
                video_id: true,
                comment_id: true,
                created_at: true,
                event: {
                    select: {
                        content_text: true
                    }
                }
            }
        });
    }

    static async requestDraft(accountId: string, leadId: string, force: boolean = false) {
        const lead = await prisma.leadOpportunity.findFirst({
            where: { id: leadId, account_id: accountId },
            include: {
                event: {
                    select: {
                        content_text: true
                    }
                },
                brand: {
                    select: {
                        name: true,
                        domain: true,
                    }
                }
            }
        });
        if (!lead) throw new Error("Lead not found or access denied");

        const PROMPT_VERSION = 'v1';
        const ownerSettings = await OwnerSettingsService.getSettings(accountId);

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
                owner_settings: {
                    tone: ownerSettings.tone,
                    preferred_language: ownerSettings.preferred_language,
                    reply_redirect_target: (ownerSettings as any).reply_redirect_target,
                    reply_cta_style: (ownerSettings as any).reply_cta_style,
                    reply_qualified_mode: (ownerSettings as any).reply_qualified_mode,
                    reply_require_human_review_high_risk: (ownerSettings as any).reply_require_human_review_high_risk,
                    auto_reply_confidence_threshold: (ownerSettings as any).auto_reply_confidence_threshold,
                },
                comment_text: lead.event?.content_text || '',
                brand_name: lead.brand?.name || '',
                brand_domain: lead.brand?.domain || '',
                platform: lead.platform,
                buyer_stage: lead.buyer_stage,
                intent: lead.intent,
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
                source_language: result.source_language || result.language || 'English',
                draft_kind: 'PUBLIC_REPLY',
                reply_channel: 'THREAD_REPLY',
                cta_target: result.cta_target || (ownerSettings as any).reply_redirect_target || 'STORE',
                cta_label: result.cta_label || null,
                risk_flags: result.risk_flags || [],
                status: (ownerSettings as any).reply_qualified_mode === 'DIRECT_SEND_AI' ? 'APPROVED' : 'DRAFT',
                approved_at: (ownerSettings as any).reply_qualified_mode === 'DIRECT_SEND_AI' ? new Date() : null,
                generation_meta: {
                    prompt_version: result.prompt_version,
                    model: result.model,
                    latency: result.latency,
                    reply_strategy: result.reply_strategy,
                    human_review_required: result.human_review_required ?? true,
                    reply_redirect_target: result.cta_target || (ownerSettings as any).reply_redirect_target || 'STORE',
                    original_comment: lead.event?.content_text || null,
                }
            }
        });
    }
}
