import { prisma } from '../db';

type DbLike = any;

export interface GenerateApplyCandidatesInput {
    db?: DbLike;
    accountId: string;
    learningApplyPlanId: string;
    force?: boolean;
}

export interface ListApplyCandidatesInput {
    db?: DbLike;
    accountId: string;
    brandId?: string | null;
    platform?: string | null;
    status?: string | null;
    candidateType?: string | null;
    limit?: number;
}

export interface UpdateApplyCandidateStatusInput {
    db?: DbLike;
    accountId: string;
    candidateId: string;
    status: 'ACCEPTED' | 'REJECTED' | 'ARCHIVED';
    reviewedBy?: string | null;
    reviewNote?: string | null;
}

type CandidateDraft = {
    account_id: string;
    brand_id: string | null;
    platform: string | null;
    learning_suggestion_id: string | null;
    learning_apply_plan_id: string;
    candidate_type: string;
    status: 'PENDING';
    title: string;
    description: string;
    candidate_payload: Record<string, any>;
    source_feedback_ids: string[];
    risk_level: string;
    created_by: 'SYSTEM';
    metadata: Record<string, any>;
};

const CANDIDATE_STATUSES = new Set([
    'PENDING',
    'ACCEPTED',
    'REJECTED',
    'ARCHIVED',
    'IMPLEMENTED',
]);
const REVIEWABLE_STATUSES = new Set(['ACCEPTED', 'REJECTED', 'ARCHIVED']);
const CANDIDATE_TYPES = new Set([
    'BANNED_PHRASE',
    'STYLE_GUIDANCE',
    'DRAFT_QC_TEST_CASE',
    'INTENT_MAPPING_TEST_CASE',
    'PRODUCT_GROUNDING_REVIEW',
    'BRAND_PROFILE_HINT',
    'FOLLOW_UP_PROMPT_TEST_CASE',
    'OTHER',
]);
const AI_PHRASE_MARKERS = [
    '欢迎访问',
    '探索更多',
    '亲爱的用户',
    '亲爱的顾客',
    '感谢关注',
    '希望能帮助到你',
    '如有任何疑问',
    'please visit our store',
    'thank you for your interest',
    'dear customer',
    'feel free to contact us',
];

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

function normalizeCandidateStatus(value: unknown): string | null {
    const normalized = normalizeToken(value);
    if (!normalized) return null;
    if (!CANDIDATE_STATUSES.has(normalized)) {
        throw new Error(`Invalid apply candidate status: ${String(value)}`);
    }
    return normalized;
}

function normalizeCandidateType(value: unknown): string | null {
    const normalized = normalizeToken(value);
    if (!normalized) return null;
    if (!CANDIDATE_TYPES.has(normalized)) {
        throw new Error(`Invalid apply candidate type: ${String(value)}`);
    }
    return normalized;
}

function normalizeReviewStatus(value: unknown): 'ACCEPTED' | 'REJECTED' | 'ARCHIVED' {
    const normalized = normalizeCandidateStatus(value);
    if (!normalized || !REVIEWABLE_STATUSES.has(normalized)) {
        throw new Error(`Invalid apply candidate review status: ${String(value)}`);
    }
    return normalized as 'ACCEPTED' | 'REJECTED' | 'ARCHIVED';
}

function clampLimit(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 50;
    return Math.min(200, Math.floor(parsed));
}

function jsonArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value
            .map((item) => cleanString(item))
            .filter(Boolean) as string[]
        : [];
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        return `{${Object.keys(value as Record<string, unknown>)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}

function evidenceSignature(draft: Omit<CandidateDraft, 'metadata'>) {
    return stableStringify({
        account_id: draft.account_id,
        brand_id: draft.brand_id,
        platform: draft.platform,
        learning_apply_plan_id: draft.learning_apply_plan_id,
        candidate_type: draft.candidate_type,
        title: draft.title,
        payload: draft.candidate_payload,
    });
}

function candidateBase(plan: any, suggestion: any | null) {
    return {
        account_id: plan.account_id,
        brand_id: cleanString(plan.brand_id || suggestion?.brand_id),
        platform: cleanString(plan.platform || suggestion?.platform),
        learning_suggestion_id: cleanString(plan.learning_suggestion_id || suggestion?.id),
        learning_apply_plan_id: plan.id,
        status: 'PENDING' as const,
        source_feedback_ids: jsonArray(suggestion?.source_feedback_ids),
        risk_level: cleanString(plan.risk_level) || 'medium',
        created_by: 'SYSTEM' as const,
    };
}

function makeCandidate(
    plan: any,
    suggestion: any | null,
    candidateType: string,
    title: string,
    description: string,
    candidatePayload: Record<string, any>,
): CandidateDraft {
    const base = candidateBase(plan, suggestion);
    const draftWithoutMetadata = {
        ...base,
        candidate_type: candidateType,
        title,
        description,
        candidate_payload: candidatePayload,
    };
    return {
        ...draftWithoutMetadata,
        metadata: {
            evidence_signature: evidenceSignature(draftWithoutMetadata),
            source_target_area: plan.target_area,
            source_proposed_change_type: plan.proposed_change_type,
            source_plan_status: plan.status,
            source_suggestion_type: suggestion?.suggestion_type || null,
        },
    };
}

async function loadSourceFeedbackExamples(
    db: DbLike,
    accountId: string,
    sourceFeedbackIds: string[],
) {
    if (!sourceFeedbackIds.length || !db.draftFeedback?.findMany) {
        return [];
    }
    const rows = await db.draftFeedback.findMany({
        where: { account_id: accountId },
        orderBy: { created_at: 'desc' },
    });
    const idSet = new Set(sourceFeedbackIds);
    return rows.filter((row: any) => idSet.has(row.id));
}

function findAiPhraseMarkers(rows: any[]): string[] {
    const found = new Set<string>();
    for (const row of rows) {
        const text = [
            row.original_draft_text,
            row.human_edited_text,
            row.final_sent_text,
            row.feedback_note,
        ]
            .map((value) => cleanString(value)?.toLowerCase())
            .filter(Boolean)
            .join('\n');
        for (const marker of AI_PHRASE_MARKERS) {
            if (text.includes(marker.toLowerCase())) {
                found.add(marker);
            }
        }
    }
    return Array.from(found);
}

function buildCandidateDrafts(plan: any, suggestion: any | null, sourceFeedbackRows: any[]) {
    const targetArea = cleanString(plan.target_area) || 'manual_review';
    const candidates: CandidateDraft[] = [];

    if (targetArea === 'ai_core_prompt_style') {
        candidates.push(makeCandidate(
            plan,
            suggestion,
            'STYLE_GUIDANCE',
            'Review platform style guidance candidate',
            'Inactive candidate to review style guidance for natural, non-customer-service replies.',
            {
                target: 'platform_style_profile',
                candidate_guidance: [
                    'avoid robotic greeting',
                    'avoid customer-service tone',
                    'prefer concrete answer before CTA',
                ],
                requires_code_change: true,
            },
        ));

        const phraseMarkers = findAiPhraseMarkers(sourceFeedbackRows);
        if (phraseMarkers.length > 0) {
            candidates.push(makeCandidate(
                plan,
                suggestion,
                'BANNED_PHRASE',
                'Review repeated AI phrase candidates',
                'Inactive candidate to review repeated AI/customer-service phrases from source examples.',
                {
                    target: 'platform_style_profile',
                    phrase_candidates: phraseMarkers,
                    requires_code_change: true,
                },
            ));
        }
        return candidates;
    }

    if (targetArea === 'reply_strategy_adapter') {
        candidates.push(makeCandidate(
            plan,
            suggestion,
            'DRAFT_QC_TEST_CASE',
            'Review CTA gating regression test candidates',
            'Inactive candidate for regression tests around CTA gating behavior.',
            {
                target: 'cta_gating',
                expected_behavior: [
                    'suitability_advice should not CTA',
                    'purchase_request may CTA',
                ],
                requires_code_change: true,
            },
        ));
        return candidates;
    }

    if (targetArea === 'intent_mapping') {
        candidates.push(makeCandidate(
            plan,
            suggestion,
            'INTENT_MAPPING_TEST_CASE',
            'Review fallback intent mapping test candidates',
            'Inactive candidate for fallback intent bucket regression examples.',
            {
                target: 'fallback_intent_buckets',
                test_case_source: 'feedback_examples',
                requires_code_change: true,
            },
        ));
        return candidates;
    }

    if (targetArea === 'product_grounding') {
        candidates.push(makeCandidate(
            plan,
            suggestion,
            'PRODUCT_GROUNDING_REVIEW',
            'Review product grounding candidate',
            'Inactive candidate to review catalog match or knowledge retrieval quality.',
            {
                target: 'catalog_match_or_knowledge_retrieval',
                review_required: true,
                requires_code_change: false,
            },
        ));
        return candidates;
    }

    if (targetArea === 'draft_qc') {
        candidates.push(makeCandidate(
            plan,
            suggestion,
            'DRAFT_QC_TEST_CASE',
            'Review DraftQC test case candidate',
            'Inactive candidate for future DraftQC rule and regression test design.',
            {
                target: 'draft_qc',
                expected_behavior: 'rejected examples should fail QC after candidate rule is designed',
                requires_code_change: true,
            },
        ));
        return candidates;
    }

    if (targetArea === 'follow_up_prompt') {
        candidates.push(makeCandidate(
            plan,
            suggestion,
            'FOLLOW_UP_PROMPT_TEST_CASE',
            'Review follow-up prompt test case candidate',
            'Inactive candidate for future follow-up prompt regression tests.',
            {
                target: 'follow_up_prompt',
                expected_behavior: [
                    'latest user reply drives strategy',
                    'previous reply is not repeated',
                ],
                requires_code_change: true,
            },
        ));
        return candidates;
    }

    if (targetArea === 'brand_reply_profile') {
        candidates.push(makeCandidate(
            plan,
            suggestion,
            'BRAND_PROFILE_HINT',
            'Review brand profile hint candidate',
            'Inactive candidate for brand owner review before profile changes are made.',
            {
                target: 'brand_reply_profile',
                review_required_by_brand_owner: true,
                requires_code_change: false,
            },
        ));
        return candidates;
    }

    candidates.push(makeCandidate(
        plan,
        suggestion,
        'OTHER',
        'Review manual apply candidate',
        'Inactive candidate for manual review because no deterministic candidate type matched.',
        {
            target: targetArea,
            review_required: true,
            requires_code_change: false,
        },
    ));
    return candidates;
}

async function hasPendingDuplicate(db: DbLike, candidate: CandidateDraft) {
    const rows = await db.applyCandidate.findMany({
        where: {
            account_id: candidate.account_id,
            learning_apply_plan_id: candidate.learning_apply_plan_id,
            candidate_type: candidate.candidate_type,
            status: 'PENDING',
        },
    });
    const signature = candidate.metadata.evidence_signature;
    return rows.some((row: any) => row?.metadata?.evidence_signature === signature);
}

export async function generateApplyCandidatesFromPlan(input: GenerateApplyCandidatesInput) {
    const db = input.db || prisma;
    const accountId = requireAccountId(input.accountId);
    const learningApplyPlanId = cleanString(input.learningApplyPlanId);
    if (!learningApplyPlanId) {
        throw new Error('learningApplyPlanId is required');
    }

    const plan = await db.learningApplyPlan.findUnique({
        where: { id: learningApplyPlanId },
    });
    if (!plan) {
        throw new Error('LearningApplyPlan not found');
    }
    if (plan.account_id !== accountId) {
        throw new Error('LearningApplyPlan account scope mismatch');
    }
    if (plan.status !== 'REVIEWED') {
        throw new Error(`LearningApplyPlan must be REVIEWED, got ${plan.status}`);
    }

    const learningSuggestionId = cleanString(plan.learning_suggestion_id);
    const suggestion = learningSuggestionId
        ? await db.learningSuggestion.findUnique({ where: { id: learningSuggestionId } })
        : null;
    if (learningSuggestionId && !suggestion) {
        throw new Error('LearningSuggestion not found');
    }
    if (suggestion && suggestion.account_id !== accountId) {
        throw new Error('LearningSuggestion account scope mismatch');
    }

    const sourceFeedbackIds = jsonArray(suggestion?.source_feedback_ids);
    const sourceFeedbackRows = await loadSourceFeedbackExamples(db, accountId, sourceFeedbackIds);
    const drafts = buildCandidateDrafts(plan, suggestion, sourceFeedbackRows);
    const candidates: any[] = [];
    let skippedDuplicateCount = 0;

    for (const draft of drafts) {
        if (!input.force && await hasPendingDuplicate(db, draft)) {
            skippedDuplicateCount += 1;
            continue;
        }
        const created = await db.applyCandidate.create({ data: draft });
        candidates.push(created);
    }

    return {
        candidates,
        persisted_count: candidates.length,
        skipped_duplicate_count: skippedDuplicateCount,
    };
}

export async function listApplyCandidates(input: ListApplyCandidatesInput) {
    const db = input.db || prisma;
    const accountId = requireAccountId(input.accountId);
    const where: Record<string, any> = {
        account_id: accountId,
    };
    const brandId = cleanString(input.brandId);
    const platform = cleanString(input.platform);
    const status = normalizeCandidateStatus(input.status);
    const candidateType = normalizeCandidateType(input.candidateType);
    if (brandId) where.brand_id = brandId;
    if (platform) where.platform = platform;
    if (status) where.status = status;
    if (candidateType) where.candidate_type = candidateType;

    return db.applyCandidate.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: clampLimit(input.limit),
    });
}

function assertTransition(currentStatus: string, nextStatus: string) {
    const allowed =
        (currentStatus === 'PENDING' && REVIEWABLE_STATUSES.has(nextStatus)) ||
        (currentStatus === 'ACCEPTED' && nextStatus === 'ARCHIVED');
    if (!allowed) {
        throw new Error(`Invalid apply candidate status transition: ${currentStatus} -> ${nextStatus}`);
    }
}

export async function updateApplyCandidateStatus(input: UpdateApplyCandidateStatusInput) {
    const db = input.db || prisma;
    const accountId = requireAccountId(input.accountId);
    const candidateId = cleanString(input.candidateId);
    if (!candidateId) {
        throw new Error('candidateId is required');
    }
    const nextStatus = normalizeReviewStatus(input.status);
    const existing = await db.applyCandidate.findUnique({
        where: { id: candidateId },
    });
    if (!existing) {
        throw new Error('ApplyCandidate not found');
    }
    if (existing.account_id !== accountId) {
        throw new Error('ApplyCandidate account scope mismatch');
    }
    assertTransition(existing.status, nextStatus);

    return db.applyCandidate.update({
        where: { id: candidateId },
        data: {
            status: nextStatus,
            reviewed_by: cleanString(input.reviewedBy),
            reviewed_at: new Date(),
            review_note: cleanString(input.reviewNote),
        },
    });
}
