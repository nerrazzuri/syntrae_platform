import { prisma, LeadStatus, OutcomeSource } from '../db';
import { OwnerSettingsService } from './owner/owner_settings_service';
import { buildThreadReference } from '../utils/thread_reference';
import { CatalogImportService } from './catalog_import.service';

export interface LeadFilters {
    buyer_stage?: 'AWARENESS' | 'EVALUATING' | 'READY';
    recommended_action?: 'SILENT_CAPTURE' | 'RECOMMEND_DM' | 'PRIORITY_DM';
    lead_status?: 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'CONVERTED' | 'LOST';
    min_confidence?: number;
    platform?: string;
    brand_id?: string; // Phase 37.4
    created_after?: string;
    created_before?: string;
}

export interface LeadOutcomeUpdateInput {
    lead_status?: LeadStatus;
    followed_up_at?: string | null;
    converted_at?: string | null;
    deal_value?: number | null;
    outcome_reason?: string | null;
    outcome_source?: OutcomeSource;
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
        if (filters.lead_status) where.lead_status = filters.lead_status;
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
        const [total, highIntentTotal, revenueAggregate, rawItems] = await Promise.all([
            prisma.leadOpportunity.count({ where }),
            prisma.leadOpportunity.count({
                where: {
                    ...where,
                    OR: [
                        { buyer_stage: 'READY' },
                        { recommended_action: 'PRIORITY_DM' },
                    ],
                },
            }),
            prisma.leadOpportunity.aggregate({
                where: {
                    ...where,
                    lead_status: 'CONVERTED',
                },
                _sum: {
                    deal_value: true,
                },
            }),
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
                    lead_status: true,
                    urgency_score: true,
                    risk_level: true,
                    followed_up_at: true,
                    converted_at: true,
                    deal_value: true,
                    outcome_reason: true,
                    outcome_source: true,
                    matched_catalog_item_id: true,
                    matched_catalog_item_name: true,
                    catalog_match_score: true,
                    catalog_match_reasons: true,
                    matched_catalog_item: {
                        select: {
                            id: true,
                            name: true,
                            category: true,
                            price_label: true,
                            cta_url: true,
                            cta_label: true,
                        }
                    },
                    source_event_id: true,
                    created_at: true,
                    event: {
                        select: {
                            content_text: true,
                            metadata: true,
                        }
                    },
                    // Exclude internal metadata/preferences for list view
                }
            })
        ]);

        const items = rawItems.map(({ event, ...lead }) => ({
            ...lead,
            original_comment: event?.content_text || null,
            thread_reference: buildThreadReference({
                platform: lead.platform,
                videoId: lead.video_id,
                commentId: lead.comment_id,
                userHandle: lead.user_handle,
                userProfileUrl: lead.user_profile_url,
                metadata: event?.metadata,
            })
        }));

        return {
            items,
            total,
            limit,
            offset,
            summary: {
                high_intent_leads: highIntentTotal,
                estimated_revenue: Number(revenueAggregate._sum.deal_value || 0),
            },
        };
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
                        content_text: true,
                        metadata: true,
                    }
                },
                drafts: {
                    select: {
                        id: true,
                        status: true,
                        created_at: true,
                        sent_at: true,
                    }
                },
                matched_catalog_item: {
                    select: {
                        id: true,
                        name: true,
                        category: true,
                        description: true,
                        price_label: true,
                        target_buyer: true,
                        key_benefits: true,
                        common_objections: true,
                        cta_url: true,
                        cta_label: true,
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
            original_comment: event?.content_text || null,
            thread_reference: buildThreadReference({
                platform: rest.platform,
                videoId: rest.video_id,
                commentId: rest.comment_id,
                userHandle: rest.user_handle,
                userProfileUrl: rest.user_profile_url,
                metadata: event?.metadata,
            })
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
        if (filters.lead_status) where.lead_status = filters.lead_status;
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
                lead_status: true,
                urgency_score: true,
                followed_up_at: true,
                converted_at: true,
                deal_value: true,
                outcome_reason: true,
                outcome_source: true,
                matched_catalog_item_name: true,
                catalog_match_score: true,
                catalog_match_reasons: true,
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
                },
                matched_catalog_item: {
                    select: {
                        id: true,
                        name: true,
                        category: true,
                        description: true,
                        price_label: true,
                        target_buyer: true,
                        key_benefits: true,
                        common_objections: true,
                        cta_url: true,
                        cta_label: true,
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
        const knowledgeQuery = [
            lead.event?.content_text || '',
            lead.intent || '',
            lead.matched_catalog_item_name || '',
            lead.brand?.name || '',
        ].filter(Boolean).join('\n');
        const knowledgeContext = await CatalogImportService.searchKnowledge(
            accountId,
            lead.brand_id,
            knowledgeQuery,
            3
        );
        const catalogSuggestions = Array.isArray(knowledgeContext)
            ? knowledgeContext.filter((item: any) => item?.content).slice(0, 3)
            : [];
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
                product_context: lead.matched_catalog_item ? {
                    name: lead.matched_catalog_item.name,
                    category: lead.matched_catalog_item.category,
                    description: lead.matched_catalog_item.description,
                    price_label: lead.matched_catalog_item.price_label,
                    target_buyer: lead.matched_catalog_item.target_buyer,
                    key_benefits: lead.matched_catalog_item.key_benefits,
                    common_objections: lead.matched_catalog_item.common_objections,
                    cta_url: lead.matched_catalog_item.cta_url,
                    cta_label: lead.matched_catalog_item.cta_label,
                    match_score: lead.catalog_match_score,
                    match_reasons: lead.catalog_match_reasons,
                } : null,
                knowledge_context: catalogSuggestions,
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
                    matched_catalog_item: lead.matched_catalog_item ? {
                        id: lead.matched_catalog_item.id,
                        name: lead.matched_catalog_item.name,
                        category: lead.matched_catalog_item.category,
                        price_label: lead.matched_catalog_item.price_label,
                        cta_url: lead.matched_catalog_item.cta_url,
                        cta_label: lead.matched_catalog_item.cta_label,
                    } : null,
                    imported_knowledge: catalogSuggestions,
                }
            }
        });
    }

    static async updateOutcome(accountId: string, leadId: string, updates: LeadOutcomeUpdateInput) {
        const lead = await prisma.leadOpportunity.findFirst({
            where: { id: leadId, account_id: accountId },
        });

        if (!lead) {
            throw new Error('Lead not found or access denied');
        }

        const nextStatus = updates.lead_status ?? lead.lead_status;
        let followedUpAt = updates.followed_up_at === undefined
            ? lead.followed_up_at
            : updates.followed_up_at === null
                ? null
                : new Date(updates.followed_up_at);
        let convertedAt = updates.converted_at === undefined
            ? lead.converted_at
            : updates.converted_at === null
                ? null
                : new Date(updates.converted_at);
        let dealValue = updates.deal_value === undefined ? lead.deal_value : updates.deal_value;
        let outcomeReason = updates.outcome_reason === undefined ? lead.outcome_reason : updates.outcome_reason;
        const outcomeSource = updates.outcome_source ?? lead.outcome_source;

        if (followedUpAt && Number.isNaN(followedUpAt.getTime())) {
            throw new Error('Invalid follow-up timestamp');
        }
        if (convertedAt && Number.isNaN(convertedAt.getTime())) {
            throw new Error('Invalid conversion timestamp');
        }

        if (nextStatus === LeadStatus.CONTACTED && !followedUpAt) {
            throw new Error('Contacted leads require a follow-up timestamp');
        }
        if (nextStatus === LeadStatus.QUALIFIED && !followedUpAt) {
            throw new Error('Qualified leads require a follow-up timestamp');
        }
        if (nextStatus === LeadStatus.CONVERTED) {
            if (!convertedAt) throw new Error('Converted leads require a conversion timestamp');
            if (dealValue == null || Number(dealValue) < 0) throw new Error('Converted leads require a non-negative deal value');
            if (!followedUpAt) {
                followedUpAt = convertedAt;
            }
        }
        if (nextStatus === LeadStatus.LOST && !outcomeReason?.trim()) {
            throw new Error('Lost leads require an outcome reason');
        }

        if (nextStatus !== LeadStatus.CONVERTED) {
            convertedAt = null;
            dealValue = null;
        }

        if (nextStatus === LeadStatus.NEW) {
            followedUpAt = null;
        }

        if (nextStatus !== LeadStatus.CONVERTED && nextStatus !== LeadStatus.LOST) {
            outcomeReason = null;
        }

        const updated = await prisma.leadOpportunity.update({
            where: { id: leadId },
            data: {
                lead_status: nextStatus,
                followed_up_at: followedUpAt,
                converted_at: convertedAt,
                deal_value: dealValue == null ? null : Number(dealValue),
                outcome_reason: outcomeReason?.trim() || null,
                outcome_source: outcomeSource,
            },
            include: {
                event: {
                    select: {
                        content_text: true,
                        metadata: true,
                    }
                },
                drafts: {
                    select: {
                        id: true,
                        status: true,
                        created_at: true,
                        sent_at: true,
                    }
                }
            }
        });

        const { event, ...rest } = updated;
        return {
            ...rest,
            original_comment: event?.content_text || null,
            thread_reference: buildThreadReference({
                platform: rest.platform,
                videoId: rest.video_id,
                commentId: rest.comment_id,
                userHandle: rest.user_handle,
                userProfileUrl: rest.user_profile_url,
                metadata: event?.metadata,
            })
        };
    }
}
