import { prisma } from '../db';

type DbLike = any;

export interface DraftFeedbackInsightInput {
    db?: DbLike;
    accountId?: string | null;
    brandId?: string | null;
    platform?: string | null;
    from?: string | Date | null;
    to?: string | Date | null;
    limitExamples?: number;
}

type CountMap = Record<string, number>;

const DEFAULT_LIMIT_EXAMPLES = 5;
const MAX_LIMIT_EXAMPLES = 50;
const EXAMPLE_TEXT_LIMIT = 500;

function cleanString(value: unknown): string | null {
    const text = String(value ?? '').trim();
    return text || null;
}

function parseDate(value: unknown): Date | null {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
}

function clampLimit(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT_EXAMPLES;
    return Math.min(MAX_LIMIT_EXAMPLES, Math.floor(parsed));
}

function rate(numerator: number, denominator: number): number {
    if (!denominator) return 0;
    return Number((numerator / denominator).toFixed(4));
}

function increment(map: CountMap, key: unknown, by = 1) {
    const normalized = cleanString(key) || 'UNKNOWN';
    map[normalized] = (map[normalized] || 0) + by;
}

function selectedReasons(row: any): string[] {
    return Array.isArray(row?.selected_reasons)
        ? row.selected_reasons.map((reason: unknown) => cleanString(reason)).filter(Boolean) as string[]
        : [];
}

function isQcPassed(row: any): boolean {
    return row?.qc_status?.passed === true;
}

function isFollowUp(row: any): boolean {
    return Boolean(cleanString(row?.reply_watch_id));
}

function isEdited(row: any): boolean {
    return cleanString(row?.feedback_type) === 'EDITED_BEFORE_SEND';
}

function isRejected(row: any): boolean {
    return cleanString(row?.feedback_type) === 'REJECTED';
}

function hasReason(row: any, reason: string): boolean {
    return selectedReasons(row).includes(reason);
}

function hasAnyReason(row: any, reasons: string[]): boolean {
    const rowReasons = selectedReasons(row);
    return reasons.some((reason) => rowReasons.includes(reason));
}

function truncateText(value: unknown): string | null {
    const text = cleanString(value);
    if (!text) return null;
    return text.length > EXAMPLE_TEXT_LIMIT
        ? text.slice(0, EXAMPLE_TEXT_LIMIT)
        : text;
}

function exampleRow(row: any) {
    return {
        feedback_id: row.id,
        outreach_draft_id: row.outreach_draft_id,
        brand_id: row.brand_id,
        platform: row.platform,
        feedback_type: row.feedback_type,
        selected_reasons: selectedReasons(row),
        original_draft_text: truncateText(row.original_draft_text),
        human_edited_text: truncateText(row.human_edited_text),
        final_sent_text: truncateText(row.final_sent_text),
        reply_strategy: row.reply_strategy,
        product_grounding_mode: row.product_grounding_mode,
        created_at: row.created_at,
    };
}

function addProblemGroup(
    groups: Map<string, any>,
    groupName: string,
    groupValue: unknown,
    selectedReason: string,
) {
    const value = cleanString(groupValue) || 'UNKNOWN';
    const key = `${value}\u0000${selectedReason}`;
    const current = groups.get(key) || {
        [groupName]: value,
        selected_reason: selectedReason,
        count: 0,
    };
    current.count += 1;
    groups.set(key, current);
}

function sortedGroups(groups: Map<string, any>) {
    return [...groups.values()].sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return JSON.stringify(a).localeCompare(JSON.stringify(b));
    });
}

function buildWhere(input: DraftFeedbackInsightInput) {
    const where: Record<string, any> = {};
    const accountId = cleanString(input.accountId);
    const brandId = cleanString(input.brandId);
    const platform = cleanString(input.platform);
    const from = parseDate(input.from);
    const to = parseDate(input.to);

    if (accountId) where.account_id = accountId;
    if (brandId) where.brand_id = brandId;
    if (platform) where.platform = platform;
    if (from || to) {
        where.created_at = {};
        if (from) where.created_at.gte = from;
        if (to) where.created_at.lte = to;
    }

    return where;
}

function emptyInsights() {
    return {
        total_feedback: 0,
        by_feedback_type: {},
        by_selected_reason: {},
        by_reply_strategy: {},
        by_product_grounding_mode: {},
        by_buyer_stage: {},
        by_platform: {},
        too_ai_count: 0,
        too_salesy_count: 0,
        too_vague_count: 0,
        wrong_strategy_count: 0,
        unsafe_or_overclaim_count: 0,
        accepted_as_is_count: 0,
        edited_count: 0,
        rejected_count: 0,
        needs_rewrite_count: 0,
        acceptance_rate: 0,
        edit_rate: 0,
        rejection_rate: 0,
        first_draft_feedback_count: 0,
        follow_up_feedback_count: 0,
        follow_up_rejected_count: 0,
        follow_up_rejection_rate: 0,
        first_draft_rejected_count: 0,
        first_draft_rejection_rate: 0,
        qc_passed_but_rejected_count: 0,
        qc_passed_but_edited_count: 0,
        qc_passed_with_too_ai_reason_count: 0,
        qc_passed_with_too_salesy_reason_count: 0,
        top_problem_groups: {
            by_reply_strategy_and_selected_reason: [],
            by_product_grounding_mode_and_selected_reason: [],
            by_platform_and_selected_reason: [],
        },
        feedback_examples: [],
        rejected_examples: [],
        edited_examples: [],
        qc_mismatch_examples: [],
    };
}

export async function getDraftFeedbackInsights(input: DraftFeedbackInsightInput = {}) {
    const db = input.db || prisma;
    const limitExamples = clampLimit(input.limitExamples);
    const rows = await db.draftFeedback.findMany({
        where: buildWhere(input),
        orderBy: { created_at: 'desc' },
    });

    const insights: any = emptyInsights();
    insights.total_feedback = rows.length;

    const strategyReasonGroups = new Map<string, any>();
    const groundingReasonGroups = new Map<string, any>();
    const platformReasonGroups = new Map<string, any>();

    for (const row of rows) {
        const feedbackType = cleanString(row.feedback_type) || 'OTHER';
        const reasons = selectedReasons(row);

        increment(insights.by_feedback_type, feedbackType);
        increment(insights.by_reply_strategy, row.reply_strategy);
        increment(insights.by_product_grounding_mode, row.product_grounding_mode);
        increment(insights.by_buyer_stage, row.buyer_stage);
        increment(insights.by_platform, row.platform);

        for (const reason of reasons) {
            increment(insights.by_selected_reason, reason);
            addProblemGroup(strategyReasonGroups, 'reply_strategy', row.reply_strategy, reason);
            addProblemGroup(
                groundingReasonGroups,
                'product_grounding_mode',
                row.product_grounding_mode,
                reason,
            );
            addProblemGroup(platformReasonGroups, 'platform', row.platform, reason);
        }

        if (feedbackType === 'TOO_AI' || hasReason(row, 'TOO_AI')) {
            insights.too_ai_count += 1;
        }
        if (
            feedbackType === 'TOO_SALESY' ||
            hasAnyReason(row, ['TOO_SALESY', 'CTA_SHOULD_NOT_BE_INCLUDED'])
        ) {
            insights.too_salesy_count += 1;
        }
        if (
            feedbackType === 'TOO_VAGUE' ||
            hasAnyReason(row, ['TOO_GENERIC', 'TOO_SHORT'])
        ) {
            insights.too_vague_count += 1;
        }
        if (feedbackType === 'WRONG_STRATEGY' || hasReason(row, 'WRONG_INTENT')) {
            insights.wrong_strategy_count += 1;
        }
        if (
            feedbackType === 'UNSAFE_OR_OVERCLAIM' ||
            hasReason(row, 'UNSAFE_CLAIM')
        ) {
            insights.unsafe_or_overclaim_count += 1;
        }

        if (feedbackType === 'ACCEPTED_AS_IS') insights.accepted_as_is_count += 1;
        if (feedbackType === 'EDITED_BEFORE_SEND') insights.edited_count += 1;
        if (feedbackType === 'REJECTED') insights.rejected_count += 1;
        if (feedbackType === 'NEEDS_REWRITE') insights.needs_rewrite_count += 1;

        if (isFollowUp(row)) {
            insights.follow_up_feedback_count += 1;
            if (isRejected(row)) insights.follow_up_rejected_count += 1;
        } else {
            insights.first_draft_feedback_count += 1;
            if (isRejected(row)) insights.first_draft_rejected_count += 1;
        }

        if (isQcPassed(row) && isRejected(row)) {
            insights.qc_passed_but_rejected_count += 1;
        }
        if (isQcPassed(row) && isEdited(row)) {
            insights.qc_passed_but_edited_count += 1;
        }
        if (isQcPassed(row) && hasReason(row, 'TOO_AI')) {
            insights.qc_passed_with_too_ai_reason_count += 1;
        }
        if (isQcPassed(row) && hasReason(row, 'TOO_SALESY')) {
            insights.qc_passed_with_too_salesy_reason_count += 1;
        }
    }

    insights.acceptance_rate = rate(insights.accepted_as_is_count, rows.length);
    insights.edit_rate = rate(insights.edited_count, rows.length);
    insights.rejection_rate = rate(insights.rejected_count, rows.length);
    insights.follow_up_rejection_rate = rate(
        insights.follow_up_rejected_count,
        insights.follow_up_feedback_count,
    );
    insights.first_draft_rejection_rate = rate(
        insights.first_draft_rejected_count,
        insights.first_draft_feedback_count,
    );

    insights.top_problem_groups = {
        by_reply_strategy_and_selected_reason: sortedGroups(strategyReasonGroups),
        by_product_grounding_mode_and_selected_reason: sortedGroups(groundingReasonGroups),
        by_platform_and_selected_reason: sortedGroups(platformReasonGroups),
    };

    insights.feedback_examples = rows
        .slice(0, limitExamples)
        .map(exampleRow);
    insights.rejected_examples = rows
        .filter(isRejected)
        .slice(0, limitExamples)
        .map(exampleRow);
    insights.edited_examples = rows
        .filter(isEdited)
        .slice(0, limitExamples)
        .map(exampleRow);
    insights.qc_mismatch_examples = rows
        .filter((row: any) => isQcPassed(row) && (isRejected(row) || isEdited(row)))
        .slice(0, limitExamples)
        .map(exampleRow);

    return insights;
}

function highCount(count: number, total: number): boolean {
    return count >= 3 || (total >= 5 && count / total >= 0.25);
}

export function buildFeedbackRecommendations(insights: any) {
    const total = Number(insights?.total_feedback || 0);
    const recommendations: Array<Record<string, any>> = [];
    const selected = insights?.by_selected_reason || {};

    if (highCount(Number(selected.TOO_AI || 0), total)) {
        recommendations.push({
            type: 'PROMPT_REVIEW',
            severity: 'HIGH',
            message: 'Review platform style guidance and banned phrases; human feedback often says replies sound too AI-generated.',
            evidence: { selected_reason: 'TOO_AI', count: selected.TOO_AI },
        });
    }

    const salesyCount =
        Number(selected.TOO_SALESY || 0) +
        Number(selected.CTA_SHOULD_NOT_BE_INCLUDED || 0);
    if (highCount(salesyCount, total)) {
        recommendations.push({
            type: 'CTA_STRATEGY_REVIEW',
            severity: 'HIGH',
            message: 'Review CTA gating and should_redirect strategy; feedback indicates sales or CTA language is appearing when it should not.',
            evidence: {
                too_salesy_count: selected.TOO_SALESY || 0,
                cta_should_not_be_included_count:
                    selected.CTA_SHOULD_NOT_BE_INCLUDED || 0,
            },
        });
    }

    if (highCount(Number(selected.WRONG_INTENT || 0), total)) {
        recommendations.push({
            type: 'INTENT_REVIEW',
            severity: 'MEDIUM',
            message: 'Review fallback intent buckets and SignalInference mapping; human feedback indicates wrong intent selection.',
            evidence: { selected_reason: 'WRONG_INTENT', count: selected.WRONG_INTENT },
        });
    }

    if (highCount(Number(selected.PRODUCT_INFO_WRONG || 0), total)) {
        recommendations.push({
            type: 'GROUNDING_REVIEW',
            severity: 'HIGH',
            message: 'Review product catalog grounding and matched catalog item quality; feedback indicates product information is wrong.',
            evidence: {
                selected_reason: 'PRODUCT_INFO_WRONG',
                count: selected.PRODUCT_INFO_WRONG,
            },
        });
    }

    if (highCount(Number(insights?.qc_passed_but_rejected_count || 0), total)) {
        recommendations.push({
            type: 'DRAFT_QC_REVIEW',
            severity: 'HIGH',
            message: 'Improve DraftQC coverage; drafts passed QC but were later rejected by reviewers.',
            evidence: {
                qc_passed_but_rejected_count:
                    insights.qc_passed_but_rejected_count,
            },
        });
    }

    if (
        Number(insights?.follow_up_feedback_count || 0) > 0 &&
        Number(insights?.first_draft_feedback_count || 0) > 0 &&
        Number(insights.follow_up_rejection_rate || 0) >
            Number(insights.first_draft_rejection_rate || 0)
    ) {
        recommendations.push({
            type: 'FOLLOW_UP_REVIEW',
            severity: 'MEDIUM',
            message: 'Review follow-up prompt context and previous reply handling; follow-up drafts are rejected more often than first drafts.',
            evidence: {
                follow_up_rejection_rate: insights.follow_up_rejection_rate,
                first_draft_rejection_rate: insights.first_draft_rejection_rate,
            },
        });
    }

    return recommendations;
}
