import { prisma } from '../db';
import { getDraftFeedbackInsights } from './draftFeedbackInsight.service';

type DbLike = any;

const SUGGESTION_TYPES = new Set([
    'PROMPT_STYLE_REVIEW',
    'BANNED_PHRASE_CANDIDATE',
    'CTA_GATING_REVIEW',
    'INTENT_MAPPING_REVIEW',
    'PRODUCT_GROUNDING_REVIEW',
    'DRAFT_QC_RULE_REVIEW',
    'FOLLOW_UP_PROMPT_REVIEW',
    'BRAND_PROFILE_REVIEW',
    'OTHER',
]);

const SUGGESTION_STATUSES = new Set([
    'OPEN',
    'ACCEPTED',
    'REJECTED',
    'APPLIED',
    'ARCHIVED',
]);

const REVIEWABLE_STATUSES = new Set(['ACCEPTED', 'REJECTED', 'ARCHIVED']);

export interface GenerateLearningSuggestionsInput {
    db?: DbLike;
    accountId: string;
    brandId?: string | null;
    platform?: string | null;
    from?: string | Date | null;
    to?: string | Date | null;
    dryRun?: boolean;
}

export interface ListLearningSuggestionsInput {
    db?: DbLike;
    accountId: string;
    brandId?: string | null;
    platform?: string | null;
    status?: string | null;
    suggestionType?: string | null;
    limit?: number;
}

export interface UpdateLearningSuggestionStatusInput {
    db?: DbLike;
    accountId: string;
    suggestionId: string;
    status: 'ACCEPTED' | 'REJECTED' | 'ARCHIVED';
    reviewedBy?: string | null;
    reviewNote?: string | null;
}

interface SuggestionDraft {
    account_id: string;
    brand_id: string | null;
    platform: string | null;
    suggestion_type: string;
    status: string;
    severity: string;
    title: string;
    message: string;
    evidence: Record<string, any>;
    proposed_action: Record<string, any>;
    source_insight: Record<string, any>;
    source_feedback_ids: string[];
    created_by: string;
    metadata: Record<string, any>;
}

function cleanString(value: unknown): string | null {
    const text = String(value ?? '').trim();
    return text || null;
}

function normalizeToken(value: unknown): string | null {
    const text = cleanString(value);
    return text ? text.toUpperCase().replace(/[\s-]+/g, '_') : null;
}

function requireAccountId(value: unknown): string {
    const accountId = cleanString(value);
    if (!accountId) {
        throw new Error('accountId is required');
    }
    return accountId;
}

function normalizeSuggestionType(value: unknown): string | null {
    const normalized = normalizeToken(value);
    if (!normalized) return null;
    if (!SUGGESTION_TYPES.has(normalized)) {
        throw new Error(`Invalid suggestionType: ${String(value)}`);
    }
    return normalized;
}

function normalizeStatus(value: unknown): string | null {
    const normalized = normalizeToken(value);
    if (!normalized) return null;
    if (!SUGGESTION_STATUSES.has(normalized)) {
        throw new Error(`Invalid status: ${String(value)}`);
    }
    return normalized;
}

function normalizeReviewStatus(value: unknown): 'ACCEPTED' | 'REJECTED' | 'ARCHIVED' {
    const normalized = normalizeStatus(value);
    if (!normalized || !REVIEWABLE_STATUSES.has(normalized)) {
        throw new Error(`Invalid review status: ${String(value)}`);
    }
    return normalized as 'ACCEPTED' | 'REJECTED' | 'ARCHIVED';
}

function clampLimit(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 50;
    return Math.min(200, Math.floor(parsed));
}

function highCount(count: number, total: number): boolean {
    return count >= 3 || (total >= 5 && count / total >= 0.25);
}

function count(insights: any, reason: string): number {
    return Number(insights?.by_selected_reason?.[reason] || 0);
}

function sourceFeedbackIds(insights: any): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const group of [
        insights?.rejected_examples || [],
        insights?.edited_examples || [],
        insights?.qc_mismatch_examples || [],
    ]) {
        for (const example of group) {
            const id = cleanString(example?.feedback_id);
            if (id && !seen.has(id)) {
                seen.add(id);
                result.push(id);
            }
        }
    }
    return result.slice(0, 20);
}

function topGroups(groups: any[] = [], reason: string, limit = 5) {
    return groups
        .filter((group) => group?.selected_reason === reason)
        .slice(0, limit);
}

function baseSourceInsight(insights: any) {
    return {
        total_feedback: insights.total_feedback,
        by_selected_reason: insights.by_selected_reason,
        rejected_examples: insights.rejected_examples,
        edited_examples: insights.edited_examples,
        qc_mismatch_examples: insights.qc_mismatch_examples,
    };
}

function evidenceSignature(
    accountId: string,
    brandId: string | null,
    platform: string | null,
    suggestionType: string,
    evidence: Record<string, any>,
) {
    const keyEvidence = {
        selected_reason: evidence.selected_reason || null,
        recommendation_type: evidence.recommendation_type || null,
        rule: evidence.rule || null,
    };
    return JSON.stringify({
        suggestion_type: suggestionType,
        account_id: accountId,
        brand_id: brandId || null,
        platform: platform || null,
        evidence: keyEvidence,
    });
}

function makeSuggestion(
    input: {
        accountId: string;
        brandId: string | null;
        platform: string | null;
        suggestionType: string;
        severity: string;
        title: string;
        message: string;
        evidence: Record<string, any>;
        proposedAction: Record<string, any>;
        sourceInsight: Record<string, any>;
        sourceFeedbackIds: string[];
    },
): SuggestionDraft {
    const signature = evidenceSignature(
        input.accountId,
        input.brandId,
        input.platform,
        input.suggestionType,
        input.evidence,
    );
    return {
        account_id: input.accountId,
        brand_id: input.brandId,
        platform: input.platform,
        suggestion_type: input.suggestionType,
        status: 'OPEN',
        severity: input.severity,
        title: input.title,
        message: input.message,
        evidence: input.evidence,
        proposed_action: input.proposedAction,
        source_insight: input.sourceInsight,
        source_feedback_ids: input.sourceFeedbackIds,
        created_by: 'SYSTEM',
        metadata: { evidence_signature: signature },
    };
}

export function buildLearningSuggestionDrafts(
    insights: any,
    input: { accountId: string; brandId?: string | null; platform?: string | null },
): SuggestionDraft[] {
    const total = Number(insights?.total_feedback || 0);
    if (!total) return [];

    const accountId = requireAccountId(input.accountId);
    const brandId = cleanString(input.brandId);
    const platform = cleanString(input.platform);
    const sourceIds = sourceFeedbackIds(insights);
    const sourceInsight = baseSourceInsight(insights);
    const suggestions: SuggestionDraft[] = [];

    if (highCount(count(insights, 'TOO_AI'), total)) {
        suggestions.push(makeSuggestion({
            accountId,
            brandId,
            platform,
            suggestionType: 'PROMPT_STYLE_REVIEW',
            severity: 'HIGH',
            title: 'Review platform style guidance',
            message: 'Feedback indicates drafts are too AI-like. Review platform style profile, banned phrases, and rejected examples before changing prompts.',
            evidence: {
                selected_reason: 'TOO_AI',
                too_ai_count: count(insights, 'TOO_AI'),
                total_feedback: total,
                related_problem_groups: topGroups(
                    insights.top_problem_groups?.by_platform_and_selected_reason,
                    'TOO_AI',
                ),
            },
            proposedAction: {
                actions: [
                    'review platform style profile',
                    'review banned phrases',
                    'inspect rejected examples',
                ],
            },
            sourceInsight,
            sourceFeedbackIds: sourceIds,
        }));
    }

    const salesyCount =
        count(insights, 'TOO_SALESY') +
        count(insights, 'CTA_SHOULD_NOT_BE_INCLUDED');
    if (highCount(salesyCount, total)) {
        suggestions.push(makeSuggestion({
            accountId,
            brandId,
            platform,
            suggestionType: 'CTA_GATING_REVIEW',
            severity: 'HIGH',
            title: 'Review CTA gating behavior',
            message: 'Feedback indicates replies are too salesy or include CTA language when reviewers do not want it.',
            evidence: {
                selected_reason: 'TOO_SALESY',
                too_salesy_count: count(insights, 'TOO_SALESY'),
                cta_should_not_be_included_count: count(
                    insights,
                    'CTA_SHOULD_NOT_BE_INCLUDED',
                ),
                affected_strategies: topGroups(
                    insights.top_problem_groups?.by_reply_strategy_and_selected_reason,
                    'TOO_SALESY',
                ),
                affected_product_grounding_modes: topGroups(
                    insights.top_problem_groups?.by_product_grounding_mode_and_selected_reason,
                    'TOO_SALESY',
                ),
            },
            proposedAction: {
                actions: [
                    'review should_redirect behavior',
                    'review purchase_request upgrade rules',
                    'inspect drafts with CTA violations',
                ],
            },
            sourceInsight,
            sourceFeedbackIds: sourceIds,
        }));
    }

    if (highCount(count(insights, 'WRONG_INTENT'), total)) {
        suggestions.push(makeSuggestion({
            accountId,
            brandId,
            platform,
            suggestionType: 'INTENT_MAPPING_REVIEW',
            severity: 'MEDIUM',
            title: 'Review intent mapping',
            message: 'Feedback indicates wrong intent or strategy selection. Review fallback intent buckets and SignalInference mapping.',
            evidence: {
                selected_reason: 'WRONG_INTENT',
                wrong_intent_count: count(insights, 'WRONG_INTENT'),
                affected_reply_strategies: topGroups(
                    insights.top_problem_groups?.by_reply_strategy_and_selected_reason,
                    'WRONG_INTENT',
                ),
            },
            proposedAction: {
                actions: [
                    'review fallback intent buckets',
                    'review SignalInference mapping',
                    'add test cases from examples',
                ],
            },
            sourceInsight,
            sourceFeedbackIds: sourceIds,
        }));
    }

    if (highCount(count(insights, 'PRODUCT_INFO_WRONG'), total)) {
        suggestions.push(makeSuggestion({
            accountId,
            brandId,
            platform,
            suggestionType: 'PRODUCT_GROUNDING_REVIEW',
            severity: 'HIGH',
            title: 'Review product grounding',
            message: 'Feedback indicates wrong product information. Review matched catalog item quality and product/knowledge retrieval.',
            evidence: {
                selected_reason: 'PRODUCT_INFO_WRONG',
                product_info_wrong_count: count(insights, 'PRODUCT_INFO_WRONG'),
                affected_product_grounding_modes: topGroups(
                    insights.top_problem_groups?.by_product_grounding_mode_and_selected_reason,
                    'PRODUCT_INFO_WRONG',
                ),
            },
            proposedAction: {
                actions: [
                    'review matched catalog item quality',
                    'review product_context / knowledge_context retrieval',
                ],
            },
            sourceInsight,
            sourceFeedbackIds: sourceIds,
        }));
    }

    if (
        highCount(Number(insights.qc_passed_but_rejected_count || 0), total) ||
        highCount(Number(insights.qc_passed_but_edited_count || 0), total)
    ) {
        suggestions.push(makeSuggestion({
            accountId,
            brandId,
            platform,
            suggestionType: 'DRAFT_QC_RULE_REVIEW',
            severity: 'HIGH',
            title: 'Review DraftQC coverage',
            message: 'Drafts passed QC but were later rejected or edited by reviewers. Add QC checks only after human review.',
            evidence: {
                recommendation_type: 'QC_PASSED_HUMAN_REJECTED',
                qc_passed_but_rejected_count: insights.qc_passed_but_rejected_count,
                qc_passed_but_edited_count: insights.qc_passed_but_edited_count,
                selected_reasons: insights.by_selected_reason,
            },
            proposedAction: {
                actions: [
                    'add DraftQC checks',
                    'add banned phrase candidates',
                    'add regression tests',
                ],
            },
            sourceInsight,
            sourceFeedbackIds: sourceIds,
        }));
    }

    if (
        Number(insights.follow_up_feedback_count || 0) > 0 &&
        Number(insights.first_draft_feedback_count || 0) > 0 &&
        Number(insights.follow_up_rejection_rate || 0) >
            Number(insights.first_draft_rejection_rate || 0)
    ) {
        suggestions.push(makeSuggestion({
            accountId,
            brandId,
            platform,
            suggestionType: 'FOLLOW_UP_PROMPT_REVIEW',
            severity: 'MEDIUM',
            title: 'Review follow-up prompt behavior',
            message: 'Follow-up drafts are rejected more often than first drafts. Review context handling before changing prompts.',
            evidence: {
                recommendation_type: 'FOLLOW_UP_REJECTION_RATE',
                follow_up_rejection_rate: insights.follow_up_rejection_rate,
                first_draft_rejection_rate: insights.first_draft_rejection_rate,
                follow_up_rejected_count: insights.follow_up_rejected_count,
            },
            proposedAction: {
                actions: [
                    'review follow-up prompt context',
                    'ensure previous reply is not repeated',
                    'ensure latest user reply drives strategy',
                ],
            },
            sourceInsight,
            sourceFeedbackIds: sourceIds,
        }));
    }

    if (highCount(count(insights, 'NOT_BRAND_VOICE'), total)) {
        suggestions.push(makeSuggestion({
            accountId,
            brandId,
            platform,
            suggestionType: 'BRAND_PROFILE_REVIEW',
            severity: 'MEDIUM',
            title: 'Review brand reply profile',
            message: 'Feedback indicates replies do not match brand voice. Review profile and examples before applying changes.',
            evidence: {
                selected_reason: 'NOT_BRAND_VOICE',
                not_brand_voice_count: count(insights, 'NOT_BRAND_VOICE'),
                affected_brand: brandId,
                affected_platform: platform,
            },
            proposedAction: {
                actions: [
                    'update brand_reply_profile',
                    'add brand tone examples',
                    'review owner settings',
                ],
            },
            sourceInsight,
            sourceFeedbackIds: sourceIds,
        }));
    }

    return suggestions;
}

function duplicateSearchWhere(suggestion: SuggestionDraft) {
    return {
        account_id: suggestion.account_id,
        suggestion_type: suggestion.suggestion_type,
        ...(suggestion.brand_id ? { brand_id: suggestion.brand_id } : {}),
        ...(suggestion.platform ? { platform: suggestion.platform } : {}),
    };
}

function isPlainObject(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function metadataRefreshCount(metadata: unknown): number {
    if (!isPlainObject(metadata)) return 0;
    const count = Number(metadata.refresh_count || 0);
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function refreshedMetadata(existing: any, suggestion: SuggestionDraft) {
    const existingMetadata = isPlainObject(existing?.metadata) ? existing.metadata : {};
    const signature = suggestion.metadata.evidence_signature;
    return {
        ...existingMetadata,
        evidence_signature: signature,
        updated_evidence_signature: signature,
        refreshed_at: new Date().toISOString(),
        refresh_count: metadataRefreshCount(existingMetadata) + 1,
        last_refresh_reason: 'duplicate_open_suggestion_evidence_refresh',
    };
}

async function findDuplicateSuggestion(db: DbLike, suggestion: SuggestionDraft) {
    const candidates = await db.learningSuggestion.findMany({
        where: duplicateSearchWhere(suggestion),
    });
    const signature = suggestion.metadata.evidence_signature;
    return candidates.find(
        (candidate: any) =>
            candidate?.metadata?.evidence_signature === signature ||
            candidate?.metadata?.updated_evidence_signature === signature,
    );
}

export async function generateLearningSuggestions(input: GenerateLearningSuggestionsInput) {
    const db = input.db || prisma;
    const accountId = requireAccountId(input.accountId);
    const brandId = cleanString(input.brandId);
    const platform = cleanString(input.platform);
    const insights = await getDraftFeedbackInsights({
        db,
        accountId,
        brandId,
        platform,
        from: input.from,
        to: input.to,
    });
    const suggestions = buildLearningSuggestionDrafts(insights, {
        accountId,
        brandId,
        platform,
    });

    if (input.dryRun) {
        return {
            insights,
            suggestions,
            persisted_count: 0,
            refreshed_count: 0,
            skipped_duplicate_count: 0,
        };
    }

    const persisted: any[] = [];
    const refreshed: any[] = [];
    let skippedDuplicateCount = 0;

    for (const suggestion of suggestions) {
        const duplicate = await findDuplicateSuggestion(db, suggestion);
        if (duplicate?.status === 'OPEN') {
            const updated = await db.learningSuggestion.update({
                where: { id: duplicate.id },
                data: {
                    severity: suggestion.severity,
                    title: suggestion.title,
                    message: suggestion.message,
                    evidence: suggestion.evidence,
                    proposed_action: suggestion.proposed_action,
                    source_insight: suggestion.source_insight,
                    source_feedback_ids: suggestion.source_feedback_ids,
                    metadata: refreshedMetadata(duplicate, suggestion),
                },
            });
            refreshed.push(updated);
            continue;
        }
        if (duplicate) {
            skippedDuplicateCount += 1;
            continue;
        }
        const created = await db.learningSuggestion.create({ data: suggestion });
        persisted.push(created);
    }

    return {
        insights,
        suggestions: [...persisted, ...refreshed],
        persisted_count: persisted.length,
        refreshed_count: refreshed.length,
        skipped_duplicate_count: skippedDuplicateCount,
    };
}

export async function listLearningSuggestions(input: ListLearningSuggestionsInput) {
    const db = input.db || prisma;
    const accountId = requireAccountId(input.accountId);
    const where: Record<string, any> = {
        account_id: accountId,
    };
    const brandId = cleanString(input.brandId);
    const platform = cleanString(input.platform);
    const status = normalizeStatus(input.status);
    const suggestionType = normalizeSuggestionType(input.suggestionType);
    if (brandId) where.brand_id = brandId;
    if (platform) where.platform = platform;
    if (status) where.status = status;
    if (suggestionType) where.suggestion_type = suggestionType;

    return db.learningSuggestion.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: clampLimit(input.limit),
    });
}

function assertTransition(currentStatus: string, nextStatus: string) {
    const allowed =
        (currentStatus === 'OPEN' && REVIEWABLE_STATUSES.has(nextStatus)) ||
        (currentStatus === 'ACCEPTED' && nextStatus === 'ARCHIVED');
    if (!allowed) {
        throw new Error(`Invalid learning suggestion status transition: ${currentStatus} -> ${nextStatus}`);
    }
}

export async function updateLearningSuggestionStatus(
    input: UpdateLearningSuggestionStatusInput,
) {
    const db = input.db || prisma;
    const accountId = requireAccountId(input.accountId);
    const suggestionId = cleanString(input.suggestionId);
    if (!suggestionId) {
        throw new Error('suggestionId is required');
    }
    const nextStatus = normalizeReviewStatus(input.status);
    const existing = await db.learningSuggestion.findUnique({
        where: { id: suggestionId },
    });
    if (!existing) {
        throw new Error('LearningSuggestion not found');
    }
    if (existing.account_id !== accountId) {
        throw new Error('LearningSuggestion account scope mismatch');
    }
    assertTransition(existing.status, nextStatus);

    return db.learningSuggestion.update({
        where: { id: suggestionId },
        data: {
            status: nextStatus,
            reviewed_by: cleanString(input.reviewedBy),
            reviewed_at: new Date(),
            review_note: cleanString(input.reviewNote),
        },
    });
}
