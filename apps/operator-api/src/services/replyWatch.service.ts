import { prisma } from '../db';

export const ACTIVE_REPLY_WATCH_STATUSES = [
    'WAITING_USER_REPLY',
    'USER_REPLIED',
    'FOLLOW_UP_READY',
] as const;

const HIGH_VALUE_STRATEGIES = new Set([
    'suitability_advice',
    'objection_or_concern',
    'complaint_or_negative',
]);

const LIGHT_ENGAGEMENT_STRATEGIES = new Set([
    'usage_advice',
    'comparison_request',
]);

const ENGAGEMENT_STRATEGIES = new Set([
    ...HIGH_VALUE_STRATEGIES,
    ...LIGHT_ENGAGEMENT_STRATEGIES,
]);

type DbLike = any;

export interface ReplyWatchSourceInput {
    db?: DbLike;
    accountId?: string | null;
    brandId?: string | null;
    leadId?: string | null;
    outreachDraftId?: string | null;
    platform?: string | null;
    sourcePostId?: string | null;
    sourceCommentId?: string | null;
    parentCommentId?: string | null;
    threadKey?: string | null;
    replyStrategy?: string | null;
    replyMode?: string | null;
    productGroundingMode?: string | null;
    buyerStage?: string | null;
    shouldRedirect?: boolean | null;
    recommendedAction?: string | null;
    sentAt?: Date | string | null;
    metadata?: Record<string, any> | null;
    watchHours?: number | null;
}

export interface CreateReplyWatchForSentDraftInput extends ReplyWatchSourceInput {
    draft?: any;
    lead?: any;
}

function cleanString(value: unknown): string | null {
    const text = String(value ?? '').trim();
    return text || null;
}

function normalizeStrategy(value: unknown): string {
    return String(value ?? '').trim().toLowerCase();
}

function normalizeCompact(value: unknown): string {
    return normalizeStrategy(value).replace(/[\s_-]+/g, '');
}

function normalizeBuyerStage(value: unknown): string {
    return String(value ?? '').trim().toUpperCase();
}

function asDate(value: unknown, fallback = new Date()): Date {
    if (!value) return fallback;
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? fallback : date;
}

function numberOrNull(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isPlainObject(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeMetadata(
    current: unknown,
    incoming: unknown,
): Record<string, any> | undefined {
    const merged = {
        ...(isPlainObject(current) ? current : {}),
        ...(isPlainObject(incoming) ? incoming : {}),
    };
    return Object.keys(merged).length ? merged : undefined;
}

function strategyFromDraft(draft: any): string | null {
    return cleanString(draft?.generation_meta?.reply_strategy);
}

function replyModeFromDraft(draft: any): string | null {
    return cleanString(draft?.generation_meta?.strategy_meta?.reply_mode);
}

function productGroundingModeFromDraft(draft: any): string | null {
    return cleanString(
        draft?.generation_meta?.strategy_meta?.product_grounding_mode ||
        draft?.generation_meta?.product_grounding_mode,
    );
}

function productGroundingModeFromStrategy(replyStrategy: string | null | undefined): string | null {
    const strategy = normalizeStrategy(replyStrategy);
    const modeByStrategy: Record<string, string> = {
        purchase_request: 'product_first',
        product_question: 'answer_from_product',
        suitability_advice: 'diagnostic_then_product_support',
        usage_advice: 'instruction_then_product_support',
        objection_or_concern: 'concern_first_product_support',
        complaint_or_negative: 'repair_first_no_sell',
        comparison_request: 'answer_from_product',
        compliment_or_interest: 'light_optional',
        general_interest: 'light_optional',
        irrelevant_or_low_value: 'none',
    };
    return modeByStrategy[strategy] || null;
}

function shouldRedirectFromDraft(draft: any): boolean | null {
    if (typeof draft?.generation_meta?.strategy_meta?.should_redirect === 'boolean') {
        return draft.generation_meta.strategy_meta.should_redirect;
    }
    const target = cleanString(draft?.cta_target);
    if (!target) return null;
    return target.toUpperCase() !== 'NONE';
}

export function buildThreadKey(input: ReplyWatchSourceInput): string | null {
    const explicit = cleanString(input.threadKey);
    if (explicit) return explicit;

    const platform = cleanString(input.platform);
    if (!platform) return null;

    const sourcePostId = cleanString(input.sourcePostId);
    const sourceCommentId = cleanString(input.sourceCommentId);
    if (sourcePostId && sourceCommentId) {
        return `${platform}:${sourcePostId}:${sourceCommentId}`;
    }

    const leadId = cleanString(input.leadId);
    if (leadId) {
        return `${platform}:lead:${leadId}`;
    }

    return null;
}

export function getReplyWatchReason(replyStrategy: string): string {
    if (replyStrategy === 'suitability_advice') {
        return 'SUITABILITY_ADVICE_WAITING_FOR_REPLY';
    }
    if (replyStrategy === 'objection_or_concern') {
        return 'OBJECTION_NEEDS_FOLLOW_UP';
    }
    if (replyStrategy === 'complaint_or_negative') {
        return 'COMPLAINT_NEEDS_REPAIR_FOLLOW_UP';
    }
    return 'ENGAGEMENT_STRATEGY';
}

export function getWatchWindowHours(input: ReplyWatchSourceInput): number {
    const metadataHours = numberOrNull(input.metadata?.reply_watch_hours);
    const explicitHours = numberOrNull(input.watchHours);
    if (explicitHours) return explicitHours;
    if (metadataHours) return metadataHours;

    const strategy = normalizeStrategy(input.replyStrategy);
    return HIGH_VALUE_STRATEGIES.has(strategy) ? 72 : 24;
}

export function shouldCreateReplyWatch(input: ReplyWatchSourceInput): boolean {
    const replyStrategy = normalizeStrategy(input.replyStrategy);
    if (!ENGAGEMENT_STRATEGIES.has(replyStrategy)) {
        return false;
    }

    if (normalizeCompact(input.recommendedAction) === 'silentcapture') {
        return false;
    }

    const platform = cleanString(input.platform);
    if (!platform) {
        return false;
    }

    const threadKey = buildThreadKey(input);
    if (!cleanString(input.sourceCommentId) && !threadKey) {
        return false;
    }

    const shouldRedirect = input.shouldRedirect === true;
    const buyerStage = normalizeBuyerStage(input.buyerStage);
    if (shouldRedirect && buyerStage === 'READY') {
        return false;
    }

    return true;
}

function normalizeCreateInput(input: CreateReplyWatchForSentDraftInput): ReplyWatchSourceInput {
    const draft = input.draft || {};
    const lead = input.lead || draft.lead || {};
    const replyStrategy = cleanString(input.replyStrategy) || strategyFromDraft(draft);
    const productGroundingMode =
        cleanString(input.productGroundingMode) ||
        productGroundingModeFromDraft(draft) ||
        productGroundingModeFromStrategy(replyStrategy);

    return {
        ...input,
        accountId: cleanString(input.accountId) || cleanString(draft.account_id) || cleanString(lead.account_id),
        brandId: cleanString(input.brandId) || cleanString(draft.brand_id) || cleanString(lead.brand_id),
        leadId: cleanString(input.leadId) || cleanString(draft.lead_id) || cleanString(lead.id),
        outreachDraftId: cleanString(input.outreachDraftId) || cleanString(draft.id),
        platform: cleanString(input.platform) || cleanString(draft.platform) || cleanString(lead.platform),
        sourcePostId: cleanString(input.sourcePostId) || cleanString(lead.video_id),
        sourceCommentId: cleanString(input.sourceCommentId) || cleanString(lead.comment_id),
        parentCommentId: cleanString(input.parentCommentId),
        threadKey: cleanString(input.threadKey),
        replyStrategy,
        replyMode: cleanString(input.replyMode) || replyModeFromDraft(draft),
        productGroundingMode,
        buyerStage: cleanString(input.buyerStage) || cleanString(draft.buyer_stage) || cleanString(lead.buyer_stage),
        shouldRedirect: input.shouldRedirect ?? shouldRedirectFromDraft(draft),
        recommendedAction: cleanString(input.recommendedAction) || cleanString(lead.recommended_action),
        sentAt: input.sentAt || draft.sent_at || new Date(),
        metadata: mergeMetadata(draft.generation_meta, input.metadata),
        watchHours: input.watchHours,
    };
}

async function loadDraftIfNeeded(db: DbLike, input: CreateReplyWatchForSentDraftInput) {
    if (input.draft || !input.outreachDraftId) {
        return input;
    }

    const hasRequiredSource =
        cleanString(input.accountId) &&
        cleanString(input.platform) &&
        (cleanString(input.sourceCommentId) || cleanString(input.threadKey) || cleanString(input.leadId));
    if (hasRequiredSource || !db.outreachDraft?.findUnique) {
        return input;
    }

    const draft = await db.outreachDraft.findUnique({
        where: { id: input.outreachDraftId },
        include: {
            lead: {
                select: {
                    id: true,
                    account_id: true,
                    brand_id: true,
                    platform: true,
                    video_id: true,
                    comment_id: true,
                    buyer_stage: true,
                    recommended_action: true,
                },
            },
        },
    });

    return { ...input, draft, lead: draft?.lead };
}

export async function createReplyWatchForSentDraft(
    input: CreateReplyWatchForSentDraftInput,
): Promise<any | null> {
    const db = input.db || prisma;
    const loaded = await loadDraftIfNeeded(db, input);
    const normalized = normalizeCreateInput(loaded);

    if (!shouldCreateReplyWatch(normalized)) {
        return null;
    }

    const accountId = cleanString(normalized.accountId);
    const platform = cleanString(normalized.platform);
    const sourceCommentId = cleanString(normalized.sourceCommentId);
    const threadKey = buildThreadKey(normalized);
    if (!accountId || !platform || (!sourceCommentId && !threadKey)) {
        return null;
    }

    const activeStatusWhere = { in: [...ACTIVE_REPLY_WATCH_STATUSES] };
    const existing = await db.replyWatch.findFirst({
        where: sourceCommentId
            ? {
                account_id: accountId,
                platform,
                source_comment_id: sourceCommentId,
                status: activeStatusWhere,
            }
            : {
                account_id: accountId,
                thread_key: threadKey,
                status: activeStatusWhere,
            },
        orderBy: { created_at: 'desc' },
    });
    if (existing) {
        return existing;
    }

    const watchUntil = new Date(
        asDate(normalized.sentAt).getTime() + getWatchWindowHours(normalized) * 60 * 60 * 1000,
    );
    const replyStrategy = normalizeStrategy(normalized.replyStrategy);

    return db.replyWatch.create({
        data: {
            account_id: accountId,
            brand_id: cleanString(normalized.brandId),
            lead_id: cleanString(normalized.leadId),
            outreach_draft_id: cleanString(normalized.outreachDraftId),
            platform,
            source_post_id: cleanString(normalized.sourcePostId),
            source_comment_id: sourceCommentId,
            parent_comment_id: cleanString(normalized.parentCommentId),
            thread_key: threadKey,
            status: 'WAITING_USER_REPLY',
            reason: getReplyWatchReason(replyStrategy),
            reply_strategy: replyStrategy,
            reply_mode: cleanString(normalized.replyMode),
            product_grounding_mode: cleanString(normalized.productGroundingMode),
            buyer_stage: cleanString(normalized.buyerStage),
            watch_until: watchUntil,
            metadata: normalized.metadata || {},
        },
    });
}

export async function listDueReplyWatches(input: {
    db?: DbLike;
    limit?: number;
    now?: Date;
    minCheckIntervalMinutes?: number;
} = {}): Promise<any[]> {
    const db = input.db || prisma;
    const now = input.now || new Date();
    const limit = Math.min(Math.max(Number(input.limit || 50), 1), 200);
    const intervalMinutes = Math.max(Number(input.minCheckIntervalMinutes ?? 15), 0);
    const checkedBefore = new Date(now.getTime() - intervalMinutes * 60 * 1000);

    return db.replyWatch.findMany({
        where: {
            status: 'WAITING_USER_REPLY',
            watch_until: { gt: now },
            OR: [
                { last_checked_at: null },
                { last_checked_at: { lt: checkedBefore } },
            ],
        },
        orderBy: [
            { last_checked_at: 'asc' },
            { created_at: 'asc' },
        ],
        take: limit,
    });
}

export async function markReplyWatchChecked(input: {
    db?: DbLike;
    id: string;
    checkedAt?: Date | string | null;
    lastSeenReplyId?: string | null;
}): Promise<any> {
    const db = input.db || prisma;
    return db.replyWatch.update({
        where: { id: input.id },
        data: {
            last_checked_at: asDate(input.checkedAt),
            ...(cleanString(input.lastSeenReplyId)
                ? { last_seen_reply_id: cleanString(input.lastSeenReplyId) }
                : {}),
        },
    });
}

export async function markReplyWatchUserReplied(input: {
    db?: DbLike;
    id: string;
    replyId?: string | null;
    repliedAt?: Date | string | null;
    engagementEventId?: string | null;
    metadata?: Record<string, any> | null;
}): Promise<any> {
    const db = input.db || prisma;
    const existing = await db.replyWatch.findUnique({ where: { id: input.id } });
    const repliedAt = asDate(input.repliedAt);
    const metadata = mergeMetadata(existing?.metadata, {
        ...(input.metadata || {}),
        ...(cleanString(input.engagementEventId)
            ? { engagement_event_id: cleanString(input.engagementEventId) }
            : {}),
    });

    return db.replyWatch.update({
        where: { id: input.id },
        data: {
            status: 'FOLLOW_UP_READY',
            user_replied_at: repliedAt,
            follow_up_ready_at: repliedAt,
            last_seen_reply_id: cleanString(input.replyId) || existing?.last_seen_reply_id || null,
            metadata: metadata || {},
        },
    });
}

export async function expireReplyWatches(input: {
    db?: DbLike;
    now?: Date;
} = {}): Promise<number> {
    const db = input.db || prisma;
    const result = await db.replyWatch.updateMany({
        where: {
            status: 'WAITING_USER_REPLY',
            watch_until: { lte: input.now || new Date() },
        },
        data: {
            status: 'EXPIRED_NO_REPLY',
            closed_at: input.now || new Date(),
        },
    });
    return result.count;
}

export async function closeReplyWatch(input: {
    db?: DbLike;
    id: string;
    closedAt?: Date | string | null;
}): Promise<any> {
    const db = input.db || prisma;
    return db.replyWatch.update({
        where: { id: input.id },
        data: {
            status: 'CLOSED',
            closed_at: asDate(input.closedAt),
        },
    });
}
