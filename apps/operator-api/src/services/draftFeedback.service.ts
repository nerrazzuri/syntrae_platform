import { prisma } from '../db';

type DbLike = any;

export const ACCEPTED_FEEDBACK_TYPES = [
    'ACCEPTED_AS_IS',
    'EDITED_BEFORE_SEND',
    'REJECTED',
    'NEEDS_REWRITE',
    'WRONG_STRATEGY',
    'WRONG_TONE',
    'TOO_AI',
    'TOO_SALESY',
    'TOO_VAGUE',
    'UNSAFE_OR_OVERCLAIM',
    'OTHER',
] as const;

export const ACCEPTED_SELECTED_REASONS = [
    'TOO_AI',
    'TOO_GENERIC',
    'TOO_SALESY',
    'WRONG_INTENT',
    'MISSED_USER_QUESTION',
    'CTA_SHOULD_NOT_BE_INCLUDED',
    'CTA_MISSING',
    'WRONG_LANGUAGE',
    'TOO_LONG',
    'TOO_SHORT',
    'UNSAFE_CLAIM',
    'PRODUCT_INFO_WRONG',
    'NOT_BRAND_VOICE',
    'GOOD_REPLY',
    'OTHER',
] as const;

const FEEDBACK_TYPE_SET = new Set<string>(ACCEPTED_FEEDBACK_TYPES);
const SELECTED_REASON_SET = new Set<string>(ACCEPTED_SELECTED_REASONS);

export interface RecordDraftFeedbackInput {
    db?: DbLike;
    accountId?: string | null;
    outreachDraftId: string;
    feedbackType: string;
    humanEditedText?: string | null;
    feedbackNote?: string | null;
    selectedReasons?: string[] | null;
    finalSentText?: string | null;
    metadata?: Record<string, any> | null;
}

export interface ListDraftFeedbackInput {
    db?: DbLike;
    accountId?: string | null;
    outreachDraftId: string;
}

export interface DraftFeedbackSummaryInput {
    db?: DbLike;
    accountId?: string | null;
    brandId?: string | null;
}

function cleanString(value: unknown): string | null {
    const text = String(value ?? '').trim();
    return text || null;
}

function isPlainObject(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeToken(value: unknown): string {
    return String(value ?? '')
        .trim()
        .toUpperCase()
        .replace(/[\s-]+/g, '_');
}

function normalizeEnumValue(value: unknown, accepted: Set<string>, fieldName: string): string {
    const normalized = normalizeToken(value);
    if (!normalized) {
        throw new Error(`${fieldName} is required`);
    }
    if (!accepted.has(normalized)) {
        throw new Error(`Invalid ${fieldName}: ${String(value)}`);
    }
    return normalized;
}

function dedupeStrings(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        const key = value.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            result.push(value);
        }
    }
    return result;
}

export function normalizeFeedbackType(value: unknown): string {
    return normalizeEnumValue(value, FEEDBACK_TYPE_SET, 'feedbackType');
}

export function normalizeSelectedReasons(values: unknown): string[] {
    if (values == null) return [];
    if (!Array.isArray(values)) {
        throw new Error('selectedReasons must be an array');
    }
    const normalized = values.map((value) =>
        normalizeEnumValue(value, SELECTED_REASON_SET, 'selectedReasons'),
    );
    return dedupeStrings(normalized);
}

function mergeMetadata(current: unknown, incoming: unknown): Record<string, any> {
    return {
        ...(isPlainObject(current) ? current : {}),
        ...(isPlainObject(incoming) ? incoming : {}),
    };
}

function strategyMeta(generationMeta: Record<string, any>): Record<string, any> {
    return isPlainObject(generationMeta.strategy_meta)
        ? generationMeta.strategy_meta
        : {};
}

function extractReplyWatchId(generationMeta: Record<string, any>): string | null {
    return cleanString(generationMeta.reply_watch_id);
}

function extractParentDraftId(generationMeta: Record<string, any>): string | null {
    return (
        cleanString(generationMeta.parent_outreach_draft_id) ||
        cleanString(generationMeta.previous_draft_id)
    );
}

function feedbackSummary(feedbackType: string, selectedReasons: string[]) {
    return {
        feedback_type: feedbackType,
        selected_reasons: selectedReasons,
        recorded_at: new Date().toISOString(),
    };
}

export async function recordDraftFeedback(input: RecordDraftFeedbackInput) {
    const db = input.db || prisma;
    const outreachDraftId = cleanString(input.outreachDraftId);
    if (!outreachDraftId) {
        throw new Error('outreachDraftId is required');
    }

    const feedbackType = normalizeFeedbackType(input.feedbackType);
    const selectedReasons = normalizeSelectedReasons(input.selectedReasons);

    const draft = await db.outreachDraft.findUnique({
        where: { id: outreachDraftId },
    });
    if (!draft) {
        throw new Error('OutreachDraft not found');
    }

    const scopedAccountId = cleanString(input.accountId);
    if (scopedAccountId && scopedAccountId !== draft.account_id) {
        throw new Error('OutreachDraft account scope mismatch');
    }

    const accountId = cleanString(draft.account_id);
    const brandId = cleanString(draft.brand_id);
    if (!accountId || !brandId) {
        throw new Error('OutreachDraft account_id and brand_id are required');
    }

    const generationMeta = isPlainObject(draft.generation_meta)
        ? draft.generation_meta
        : {};
    const metaStrategy = strategyMeta(generationMeta);
    const replyWatchId = extractReplyWatchId(generationMeta);
    const parentOutreachDraftId = extractParentDraftId(generationMeta);
    const feedbackMetadata = mergeMetadata(input.metadata, {
        parent_outreach_draft_id: parentOutreachDraftId,
    });
    if (!parentOutreachDraftId) {
        delete feedbackMetadata.parent_outreach_draft_id;
    }

    const feedback = await db.draftFeedback.create({
        data: {
            account_id: accountId,
            brand_id: brandId,
            lead_id: cleanString(draft.lead_id),
            outreach_draft_id: outreachDraftId,
            reply_watch_id: replyWatchId,
            platform: cleanString(draft.platform),
            feedback_type: feedbackType,
            human_edited_text: cleanString(input.humanEditedText),
            feedback_note: cleanString(input.feedbackNote),
            selected_reasons: selectedReasons,
            original_draft_text: cleanString(draft.draft_text) || '',
            final_sent_text: cleanString(input.finalSentText),
            reply_strategy: cleanString(generationMeta.reply_strategy),
            reply_mode: cleanString(metaStrategy.reply_mode),
            product_grounding_mode:
                cleanString(metaStrategy.product_grounding_mode) ||
                cleanString(generationMeta.product_grounding_mode),
            buyer_stage: cleanString(draft.buyer_stage),
            intent:
                cleanString(generationMeta.intent) ||
                cleanString(generationMeta.original_intent),
            qc_status: generationMeta.qc_status ?? null,
            generation_meta: generationMeta,
            metadata: Object.keys(feedbackMetadata).length ? feedbackMetadata : null,
        },
    });

    const updatedGenerationMeta = mergeMetadata(generationMeta, {
        latest_feedback_id: feedback.id,
        feedback_summary: feedbackSummary(feedbackType, selectedReasons),
    });
    await db.outreachDraft.update({
        where: { id: outreachDraftId },
        data: { generation_meta: updatedGenerationMeta },
    });

    return feedback;
}

export async function listDraftFeedbackForDraft(input: ListDraftFeedbackInput) {
    const db = input.db || prisma;
    const outreachDraftId = cleanString(input.outreachDraftId);
    if (!outreachDraftId) {
        throw new Error('outreachDraftId is required');
    }

    const where: Record<string, any> = {
        outreach_draft_id: outreachDraftId,
    };
    const accountId = cleanString(input.accountId);
    if (accountId) {
        where.account_id = accountId;
    }

    return db.draftFeedback.findMany({
        where,
        orderBy: { created_at: 'desc' },
    });
}

export async function getDraftFeedbackSummary(input: DraftFeedbackSummaryInput = {}) {
    const db = input.db || prisma;
    const where: Record<string, any> = {};
    const accountId = cleanString(input.accountId);
    const brandId = cleanString(input.brandId);
    if (accountId) where.account_id = accountId;
    if (brandId) where.brand_id = brandId;

    const rows = await db.draftFeedback.findMany({ where });
    const byFeedbackType: Record<string, number> = {};
    const topSelectedReasons: Record<string, number> = {};

    for (const row of rows) {
        const feedbackType = cleanString(row.feedback_type) || 'OTHER';
        byFeedbackType[feedbackType] = (byFeedbackType[feedbackType] || 0) + 1;

        const reasons = Array.isArray(row.selected_reasons)
            ? row.selected_reasons
            : [];
        for (const reason of reasons) {
            const normalized = cleanString(reason);
            if (!normalized) continue;
            topSelectedReasons[normalized] = (topSelectedReasons[normalized] || 0) + 1;
        }
    }

    return {
        total: rows.length,
        by_feedback_type: byFeedbackType,
        top_selected_reasons: topSelectedReasons,
    };
}
