import { prisma } from '../db';

type DbLike = any;

export interface GenerateLearningApplyPlanInput {
    db?: DbLike;
    accountId: string;
    learningSuggestionId: string;
    force?: boolean;
}

export interface ListLearningApplyPlansInput {
    db?: DbLike;
    accountId: string;
    brandId?: string | null;
    platform?: string | null;
    status?: string | null;
    targetArea?: string | null;
    limit?: number;
}

export interface UpdateLearningApplyPlanStatusInput {
    db?: DbLike;
    accountId: string;
    planId: string;
    status: 'REVIEWED' | 'CANCELLED';
    reviewedBy?: string | null;
    reviewNote?: string | null;
}

type PlanTemplate = {
    targetArea: string;
    proposedChangeType: string;
    riskLevel: string;
    summary: string;
    rationale: string;
    proposedConfigChange: Record<string, any>;
    suggestedTests: string[];
    blockedAutoApplyReason: string;
};

const APPLY_PLAN_STATUSES = new Set(['DRAFT', 'REVIEWED', 'CANCELLED', 'SUPERSEDED']);
const REVIEW_STATUSES = new Set(['REVIEWED', 'CANCELLED']);

function cleanString(value: unknown): string | null {
    const text = String(value ?? '').trim();
    return text || null;
}

function requireAccountId(value: unknown): string {
    const accountId = cleanString(value);
    if (!accountId) {
        throw new Error('accountId is required');
    }
    return accountId;
}

function normalizeToken(value: unknown): string | null {
    const text = cleanString(value);
    return text ? text.toUpperCase().replace(/[\s-]+/g, '_') : null;
}

function normalizePlanStatus(value: unknown): string | null {
    const normalized = normalizeToken(value);
    if (!normalized) return null;
    if (!APPLY_PLAN_STATUSES.has(normalized)) {
        throw new Error(`Invalid apply plan status: ${String(value)}`);
    }
    return normalized;
}

function normalizeReviewStatus(value: unknown): 'REVIEWED' | 'CANCELLED' {
    const normalized = normalizePlanStatus(value);
    if (!normalized || !REVIEW_STATUSES.has(normalized)) {
        throw new Error(`Invalid apply plan review status: ${String(value)}`);
    }
    return normalized as 'REVIEWED' | 'CANCELLED';
}

function clampLimit(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 50;
    return Math.min(200, Math.floor(parsed));
}

function evidenceSummary(suggestion: any) {
    return {
        suggestion_type: suggestion.suggestion_type,
        severity: suggestion.severity,
        evidence: suggestion.evidence || {},
        proposed_action: suggestion.proposed_action || {},
        source_feedback_ids: Array.isArray(suggestion.source_feedback_ids)
            ? suggestion.source_feedback_ids
            : [],
    };
}

function planTemplateForSuggestion(suggestion: any): PlanTemplate {
    const type = cleanString(suggestion?.suggestion_type) || 'OTHER';
    const platform = cleanString(suggestion?.platform);
    const scope = platform ? ` on ${platform}` : '';

    const templates: Record<string, PlanTemplate> = {
        PROMPT_STYLE_REVIEW: {
            targetArea: 'ai_core_prompt_style',
            proposedChangeType: 'prompt_guidance_review',
            riskLevel: 'medium',
            summary: `Review platform style guidance${scope}`,
            rationale: 'Human feedback indicates style or banned phrase issues. This plan only previews review work and does not alter prompts.',
            proposedConfigChange: {
                candidate_changes: [
                    'review platform style profile',
                    'review banned phrases',
                    'add natural reply examples',
                ],
            },
            suggestedTests: [
                'draft generation should avoid robotic greeting',
                'XHS reply should not use customer-service phrases',
                'no CTA when should_redirect=false',
            ],
            blockedAutoApplyReason: 'Prompt behavior changes require human approval and regression tests.',
        },
        CTA_GATING_REVIEW: {
            targetArea: 'reply_strategy_adapter',
            proposedChangeType: 'cta_gating_rule_review',
            riskLevel: 'high',
            summary: `Review should_redirect behavior${scope}`,
            rationale: 'CTA behavior affects public reply safety and conversion quality. This plan previews review steps only.',
            proposedConfigChange: {
                candidate_changes: [
                    'review should_redirect behavior',
                    'review purchase_request upgrade rules',
                    'inspect drafts with CTA violations',
                ],
            },
            suggestedTests: [
                'suitability_advice should not CTA',
                'purchase_request may CTA',
                'follow-up purchase intent may CTA',
            ],
            blockedAutoApplyReason: 'CTA strategy changes can affect conversion and safety; manual approval required.',
        },
        INTENT_MAPPING_REVIEW: {
            targetArea: 'intent_mapping',
            proposedChangeType: 'fallback_bucket_review',
            riskLevel: 'high',
            summary: `Review fallback intent mapping${scope}`,
            rationale: 'Intent mapping affects strategy selection across reply generation. This plan prevents automatic behavior changes.',
            proposedConfigChange: {
                candidate_changes: [
                    'review fallback intent buckets',
                    'review SignalInference mapping',
                    'add test cases from examples',
                ],
            },
            suggestedTests: [
                'add examples from source feedback',
                'verify purchase/link queries still map to purchase_request',
                'verify advice queries stay suitability_advice',
            ],
            blockedAutoApplyReason: 'Intent mapping affects all reply behavior and must not be changed automatically.',
        },
        PRODUCT_GROUNDING_REVIEW: {
            targetArea: 'product_grounding',
            proposedChangeType: 'catalog_grounding_review',
            riskLevel: 'high',
            summary: `Review product grounding quality${scope}`,
            rationale: 'Product grounding issues can create misinformation. This plan previews catalog and retrieval review only.',
            proposedConfigChange: {
                candidate_changes: [
                    'review matched catalog item quality',
                    'review product_context / knowledge_context retrieval',
                ],
            },
            suggestedTests: [
                'product_question uses product context',
                'suitability advice does not overuse product context',
                'unknown product data is not invented',
            ],
            blockedAutoApplyReason: 'Grounding changes can cause product misinformation if applied automatically.',
        },
        DRAFT_QC_RULE_REVIEW: {
            targetArea: 'draft_qc',
            proposedChangeType: 'qc_rule_candidate',
            riskLevel: 'medium',
            summary: `Review DraftQC rule coverage${scope}`,
            rationale: 'QC changes can block valid replies. This plan records candidate rule work without changing QC behavior.',
            proposedConfigChange: {
                candidate_changes: [
                    'add DraftQC checks',
                    'add banned phrase candidates',
                    'add regression tests',
                ],
            },
            suggestedTests: [
                'rejected examples should fail QC after rule is added',
                'good examples should still pass',
            ],
            blockedAutoApplyReason: 'QC rules can overblock valid replies; manual test review required.',
        },
        FOLLOW_UP_PROMPT_REVIEW: {
            targetArea: 'follow_up_prompt',
            proposedChangeType: 'follow_up_context_review',
            riskLevel: 'medium',
            summary: `Review follow-up prompt behavior${scope}`,
            rationale: 'Follow-up behavior depends on conversation context. This plan keeps changes behind human review.',
            proposedConfigChange: {
                candidate_changes: [
                    'review follow-up prompt context',
                    'ensure previous reply is not repeated',
                    'ensure latest user reply drives strategy',
                ],
            },
            suggestedTests: [
                'latest user reply drives strategy',
                'previous reply is not repeated',
                'purchase follow-up upgrades to purchase_request',
            ],
            blockedAutoApplyReason: 'Follow-up behavior changes require conversation-level regression tests.',
        },
        BRAND_PROFILE_REVIEW: {
            targetArea: 'brand_reply_profile',
            proposedChangeType: 'brand_profile_hint_review',
            riskLevel: 'low',
            summary: `Review brand reply profile${scope}`,
            rationale: 'Brand voice is subjective and requires owner approval. This plan records profile review work only.',
            proposedConfigChange: {
                candidate_changes: [
                    'update brand_reply_profile',
                    'add brand tone examples',
                    'review owner settings',
                ],
            },
            suggestedTests: [
                'profile hints appear in prompt',
                'brand tone examples are respected',
            ],
            blockedAutoApplyReason: 'Brand voice updates require brand owner review.',
        },
        OTHER: {
            targetArea: 'manual_review',
            proposedChangeType: 'manual_review',
            riskLevel: 'medium',
            summary: `Review learning suggestion manually${scope}`,
            rationale: 'No deterministic apply plan exists for this suggestion type.',
            proposedConfigChange: { candidate_changes: [] },
            suggestedTests: [],
            blockedAutoApplyReason: 'No deterministic apply plan exists for this suggestion type.',
        },
    };

    return templates[type] || templates.OTHER;
}

function buildPlanData(suggestion: any) {
    const template = planTemplateForSuggestion(suggestion);
    return {
        account_id: suggestion.account_id,
        brand_id: cleanString(suggestion.brand_id),
        platform: cleanString(suggestion.platform),
        learning_suggestion_id: suggestion.id,
        status: 'DRAFT',
        target_area: template.targetArea,
        proposed_change_type: template.proposedChangeType,
        risk_level: template.riskLevel,
        summary: template.summary,
        rationale: template.rationale,
        proposed_patch: null,
        proposed_config_change: template.proposedConfigChange,
        suggested_tests: template.suggestedTests,
        blocked_auto_apply_reason: template.blockedAutoApplyReason,
        requires_human_approval: true,
        created_by: 'SYSTEM',
        metadata: {
            source_suggestion_type: suggestion.suggestion_type,
            source_suggestion_status: suggestion.status,
        },
        source_insight_snapshot: evidenceSummary(suggestion),
    };
}

export async function generateLearningApplyPlan(input: GenerateLearningApplyPlanInput) {
    const db = input.db || prisma;
    const accountId = requireAccountId(input.accountId);
    const learningSuggestionId = cleanString(input.learningSuggestionId);
    if (!learningSuggestionId) {
        throw new Error('learningSuggestionId is required');
    }

    const suggestion = await db.learningSuggestion.findUnique({
        where: { id: learningSuggestionId },
    });
    if (!suggestion) {
        throw new Error('LearningSuggestion not found');
    }
    if (suggestion.account_id !== accountId) {
        throw new Error('LearningSuggestion account scope mismatch');
    }
    if (suggestion.status !== 'ACCEPTED') {
        throw new Error(`LearningSuggestion must be ACCEPTED, got ${suggestion.status}`);
    }

    if (!input.force) {
        const existing = await db.learningApplyPlan.findFirst({
            where: {
                account_id: accountId,
                learning_suggestion_id: learningSuggestionId,
                status: 'DRAFT',
            },
        });
        if (existing) {
            return { plan: existing, generated: false };
        }
    }

    const { source_insight_snapshot: sourceInsightSnapshot, ...planData } =
        buildPlanData(suggestion) as any;
    const plan = await db.learningApplyPlan.create({
        data: {
            ...planData,
            metadata: {
                ...(planData.metadata || {}),
                source_insight_snapshot: sourceInsightSnapshot,
            },
        },
    });

    return { plan, generated: true };
}

export async function listLearningApplyPlans(input: ListLearningApplyPlansInput) {
    const db = input.db || prisma;
    const accountId = requireAccountId(input.accountId);
    const where: Record<string, any> = {
        account_id: accountId,
    };
    const brandId = cleanString(input.brandId);
    const platform = cleanString(input.platform);
    const status = normalizePlanStatus(input.status);
    const targetArea = cleanString(input.targetArea);
    if (brandId) where.brand_id = brandId;
    if (platform) where.platform = platform;
    if (status) where.status = status;
    if (targetArea) where.target_area = targetArea;

    return db.learningApplyPlan.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: clampLimit(input.limit),
    });
}

function assertTransition(currentStatus: string, nextStatus: string) {
    if (currentStatus !== 'DRAFT' || !REVIEW_STATUSES.has(nextStatus)) {
        throw new Error(`Invalid learning apply plan status transition: ${currentStatus} -> ${nextStatus}`);
    }
}

export async function updateLearningApplyPlanStatus(input: UpdateLearningApplyPlanStatusInput) {
    const db = input.db || prisma;
    const accountId = requireAccountId(input.accountId);
    const planId = cleanString(input.planId);
    if (!planId) {
        throw new Error('planId is required');
    }
    const nextStatus = normalizeReviewStatus(input.status);
    const existing = await db.learningApplyPlan.findUnique({
        where: { id: planId },
    });
    if (!existing) {
        throw new Error('LearningApplyPlan not found');
    }
    if (existing.account_id !== accountId) {
        throw new Error('LearningApplyPlan account scope mismatch');
    }
    assertTransition(existing.status, nextStatus);

    return db.learningApplyPlan.update({
        where: { id: planId },
        data: {
            status: nextStatus,
            reviewed_by: cleanString(input.reviewedBy),
            reviewed_at: new Date(),
            review_note: cleanString(input.reviewNote),
        },
    });
}
