import { prisma } from '../db';
import { getDraftFeedbackInsights } from './draftFeedbackInsight.service';

type DbLike = any;

export interface LearningReviewDashboardInput {
    db?: DbLike;
    accountId: string;
    brandId?: string | null;
    platform?: string | null;
    suggestionStatus?: string | null;
    planStatus?: string | null;
    limit?: number;
}

export interface LearningReviewDetailInput {
    db?: DbLike;
    accountId: string;
    learningSuggestionId: string;
}

const SUGGESTION_STATUSES = new Set([
    'OPEN',
    'ACCEPTED',
    'REJECTED',
    'APPLIED',
    'ARCHIVED',
]);
const PLAN_STATUSES = new Set(['DRAFT', 'REVIEWED', 'CANCELLED', 'SUPERSEDED']);
const TEXT_LIMIT = 500;

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

function normalizeSuggestionStatus(value: unknown): string | null {
    const normalized = normalizeToken(value);
    if (!normalized) return null;
    if (!SUGGESTION_STATUSES.has(normalized)) {
        throw new Error(`Invalid suggestionStatus: ${String(value)}`);
    }
    return normalized;
}

function normalizePlanStatus(value: unknown): string | null {
    const normalized = normalizeToken(value);
    if (!normalized) return null;
    if (!PLAN_STATUSES.has(normalized)) {
        throw new Error(`Invalid planStatus: ${String(value)}`);
    }
    return normalized;
}

function clampLimit(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 50;
    return Math.min(200, Math.floor(parsed));
}

function truncateText(value: unknown): string | null {
    const text = cleanString(value);
    if (!text) return null;
    return text.length > TEXT_LIMIT ? text.slice(0, TEXT_LIMIT) : text;
}

function selectedReasons(row: any): string[] {
    return Array.isArray(row?.selected_reasons)
        ? row.selected_reasons
            .map((reason: unknown) => cleanString(reason))
            .filter(Boolean) as string[]
        : [];
}

function sourceFeedbackIds(suggestion: any): string[] {
    return Array.isArray(suggestion?.source_feedback_ids)
        ? suggestion.source_feedback_ids
            .map((id: unknown) => cleanString(id))
            .filter(Boolean) as string[]
        : [];
}

function feedbackExample(row: any) {
    return {
        id: row.id,
        lead_id: row.lead_id,
        outreach_draft_id: row.outreach_draft_id,
        source_comment_id: row.source_comment_id,
        source_comment_text: truncateText(row.source_comment_text),
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

function feedbackRecord(row: any, leadContext: Map<string, any>) {
    const context = row.lead_id ? leadContext.get(row.lead_id) : null;
    return feedbackExample({
        ...row,
        source_comment_id: context?.source_comment_id,
        source_comment_text: context?.source_comment_text,
    });
}

function riskLevelFor(suggestion: any, plan: any | null): 'low' | 'medium' | 'high' {
    const value = cleanString(plan?.risk_level || suggestion?.severity)?.toLowerCase();
    if (value === 'high') return 'high';
    if (value === 'low') return 'low';
    return 'medium';
}

export function recommendedNextAction(suggestion: any, plan: any | null) {
    const suggestionStatus = cleanString(suggestion?.status);
    const planStatus = cleanString(plan?.status);

    if (planStatus === 'REVIEWED' || planStatus === 'CANCELLED') {
        return {
            type: 'NO_ACTION',
            message: 'Apply plan is already reviewed or cancelled.',
        };
    }
    if (suggestionStatus === 'REJECTED' || suggestionStatus === 'ARCHIVED') {
        return {
            type: 'NO_ACTION',
            message: 'Suggestion is no longer active.',
        };
    }
    if (suggestionStatus === 'OPEN') {
        return {
            type: 'ARCHIVE_OR_REJECT',
            message: 'Suggestion is open; accept/reject before apply planning.',
        };
    }
    if (suggestionStatus === 'ACCEPTED' && planStatus === 'DRAFT') {
        return {
            type: 'REVIEW_APPLY_PLAN',
            message: 'Apply plan is ready for human review.',
        };
    }
    if (suggestionStatus === 'ACCEPTED') {
        return {
            type: 'GENERATE_APPLY_PLAN',
            message: 'Accepted suggestion is ready for apply-plan generation.',
        };
    }
    return {
        type: 'NO_ACTION',
        message: 'No review action is currently required.',
    };
}

function emptySummary() {
    return {
        total_suggestions: 0,
        open_suggestions: 0,
        accepted_suggestions: 0,
        rejected_suggestions: 0,
        archived_suggestions: 0,
        draft_apply_plans: 0,
        reviewed_apply_plans: 0,
        cancelled_apply_plans: 0,
        high_risk_items: 0,
        medium_risk_items: 0,
        low_risk_items: 0,
    };
}

function incrementSummary(summary: any, suggestion: any, plan: any | null, riskLevel: string) {
    summary.total_suggestions += 1;
    if (suggestion.status === 'OPEN') summary.open_suggestions += 1;
    if (suggestion.status === 'ACCEPTED') summary.accepted_suggestions += 1;
    if (suggestion.status === 'REJECTED') summary.rejected_suggestions += 1;
    if (suggestion.status === 'ARCHIVED') summary.archived_suggestions += 1;

    if (plan?.status === 'DRAFT') summary.draft_apply_plans += 1;
    if (plan?.status === 'REVIEWED') summary.reviewed_apply_plans += 1;
    if (plan?.status === 'CANCELLED') summary.cancelled_apply_plans += 1;

    if (riskLevel === 'high') summary.high_risk_items += 1;
    if (riskLevel === 'medium') summary.medium_risk_items += 1;
    if (riskLevel === 'low') summary.low_risk_items += 1;
}

function choosePlan(plans: any[]) {
    return (
        plans.find((plan) => plan.status === 'DRAFT') ||
        plans[0] ||
        null
    );
}

async function loadSuggestions(db: DbLike, input: LearningReviewDashboardInput, accountId: string) {
    const where: Record<string, any> = { account_id: accountId };
    const brandId = cleanString(input.brandId);
    const platform = cleanString(input.platform);
    const suggestionStatus = normalizeSuggestionStatus(input.suggestionStatus);
    if (brandId) where.brand_id = brandId;
    if (platform) where.platform = platform;
    if (suggestionStatus) where.status = suggestionStatus;

    return db.learningSuggestion.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: clampLimit(input.limit),
    });
}

async function loadPlansForSuggestions(
    db: DbLike,
    accountId: string,
    suggestionIds: string[],
    planStatus?: string | null,
) {
    if (!suggestionIds.length) return [];
    const where: Record<string, any> = {
        account_id: accountId,
    };
    const normalizedPlanStatus = normalizePlanStatus(planStatus);
    if (normalizedPlanStatus) where.status = normalizedPlanStatus;

    const rows = await db.learningApplyPlan.findMany({
        where,
        orderBy: { created_at: 'desc' },
    });
    const idSet = new Set(suggestionIds);
    return rows.filter((row: any) => idSet.has(row.learning_suggestion_id));
}

async function loadFeedbackExamplesForSuggestions(
    db: DbLike,
    accountId: string,
    suggestions: any[],
) {
    const ids = new Set<string>();
    for (const suggestion of suggestions) {
        for (const id of sourceFeedbackIds(suggestion)) {
            ids.add(id);
        }
    }
    if (!ids.size) return new Map<string, any>();

    const rows = await db.draftFeedback.findMany({
        where: { account_id: accountId },
        orderBy: { created_at: 'desc' },
    });
    const result = new Map<string, any>();
    for (const row of rows) {
        if (ids.has(row.id)) {
            result.set(row.id, row);
        }
    }
    return result;
}

async function loadLeadContextForFeedback(db: DbLike, rows: any[]) {
    if (!db.leadOpportunity?.findMany || !db.engagementEvent?.findMany) {
        return new Map<string, any>();
    }

    const leadIds = Array.from(new Set(
        rows
            .map((row) => cleanString(row.lead_id))
            .filter(Boolean) as string[],
    ));
    if (!leadIds.length) return new Map<string, any>();

    const leads = await db.leadOpportunity.findMany({
        where: { id: { in: leadIds } },
    });
    const eventIds = Array.from(new Set(
        leads
            .map((lead: any) => cleanString(lead.source_event_id))
            .filter(Boolean) as string[],
    ));
    const events = eventIds.length
        ? await db.engagementEvent.findMany({
            where: { id: { in: eventIds } },
        })
        : [];
    const eventsById = new Map(events.map((event: any) => [event.id, event]));
    const context = new Map<string, any>();
    for (const lead of leads) {
        const event = eventsById.get(lead.source_event_id) as any;
        context.set(lead.id, {
            source_comment_id: lead.comment_id || event?.comment_id || null,
            source_comment_text: event?.content_text || null,
        });
    }
    return context;
}

async function loadFeedbackRecords(db: DbLike, input: LearningReviewDashboardInput, accountId: string) {
    const where: Record<string, any> = { account_id: accountId };
    const brandId = cleanString(input.brandId);
    const platform = cleanString(input.platform);
    if (brandId) where.brand_id = brandId;
    if (platform) where.platform = platform;

    const rows = await db.draftFeedback.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: clampLimit(input.limit),
    });
    const leadContext = await loadLeadContextForFeedback(db, rows);
    return rows.map((row: any) => feedbackRecord(row, leadContext));
}

function examplesForSuggestion(suggestion: any, feedbackById: Map<string, any>) {
    return sourceFeedbackIds(suggestion)
        .map((id) => feedbackById.get(id))
        .filter(Boolean)
        .slice(0, 5)
        .map(feedbackExample);
}

function buildQueueItem(suggestion: any, plans: any[], feedbackById: Map<string, any>) {
    const plan = choosePlan(plans);
    const riskLevel = riskLevelFor(suggestion, plan);
    return {
        suggestion,
        apply_plan: plan,
        source_feedback_examples: examplesForSuggestion(suggestion, feedbackById),
        next_action: recommendedNextAction(suggestion, plan),
        risk_level: riskLevel,
        created_at: suggestion.created_at,
    };
}

export async function getLearningReviewDashboard(input: LearningReviewDashboardInput) {
    const db = input.db || prisma;
    const accountId = requireAccountId(input.accountId);
    const feedbackInsights = await getDraftFeedbackInsights({
        db,
        accountId,
        brandId: input.brandId,
        platform: input.platform,
        limitExamples: input.limit,
    });
    const feedbackRecords = await loadFeedbackRecords(db, input, accountId);
    const suggestions = await loadSuggestions(db, input, accountId);
    const suggestionIds = suggestions.map((suggestion: any) => suggestion.id);
    const plans = await loadPlansForSuggestions(
        db,
        accountId,
        suggestionIds,
        input.planStatus,
    );
    const plansBySuggestion = new Map<string, any[]>();
    for (const plan of plans) {
        const current = plansBySuggestion.get(plan.learning_suggestion_id) || [];
        current.push(plan);
        plansBySuggestion.set(plan.learning_suggestion_id, current);
    }
    const feedbackById = await loadFeedbackExamplesForSuggestions(db, accountId, suggestions);
    const summary = emptySummary();
    const reviewQueue = suggestions.map((suggestion: any) => {
        const item = buildQueueItem(
            suggestion,
            plansBySuggestion.get(suggestion.id) || [],
            feedbackById,
        );
        incrementSummary(summary, item.suggestion, item.apply_plan, item.risk_level);
        return item;
    });

    return {
        summary,
        feedback_insights: feedbackInsights,
        feedback_records: feedbackRecords,
        review_queue: reviewQueue,
    };
}

export async function getLearningReviewDetail(input: LearningReviewDetailInput) {
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

    const applyPlans = await db.learningApplyPlan.findMany({
        where: {
            account_id: accountId,
            learning_suggestion_id: learningSuggestionId,
        },
        orderBy: { created_at: 'desc' },
    });
    const feedbackById = await loadFeedbackExamplesForSuggestions(db, accountId, [suggestion]);
    const plan = choosePlan(applyPlans);
    return {
        suggestion,
        apply_plans: applyPlans,
        source_feedback_examples: examplesForSuggestion(suggestion, feedbackById),
        recommended_next_action: recommendedNextAction(suggestion, plan),
    };
}
