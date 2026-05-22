import test from 'node:test';
import assert from 'node:assert/strict';

import {
    closeReplyWatch,
    createReplyWatchForSentDraft,
    expireReplyWatches,
    getWatchWindowHours,
    listDueReplyWatches,
    markReplyWatchChecked,
    markReplyWatchUserReplied,
    shouldCreateReplyWatch,
} from '../src/services/replyWatch.service';

function matchesWhere(row: any, where: any): boolean {
    if (!where) return true;
    if (where.account_id && row.account_id !== where.account_id) return false;
    if (where.platform && row.platform !== where.platform) return false;
    if (where.source_comment_id && row.source_comment_id !== where.source_comment_id) return false;
    if (where.thread_key && row.thread_key !== where.thread_key) return false;
    if (where.status?.in && !where.status.in.includes(row.status)) return false;
    if (typeof where.status === 'string' && row.status !== where.status) return false;
    if (where.watch_until?.gt && !(row.watch_until > where.watch_until.gt)) return false;
    if (where.watch_until?.lte && !(row.watch_until <= where.watch_until.lte)) return false;
    if (Array.isArray(where.OR)) {
        const matched = where.OR.some((condition: any) => {
            if (condition.last_checked_at === null) return row.last_checked_at == null;
            if (condition.last_checked_at?.lt) {
                return row.last_checked_at != null && row.last_checked_at < condition.last_checked_at.lt;
            }
            return false;
        });
        if (!matched) return false;
    }
    return true;
}

class FakeReplyWatchModel {
    rows: any[];
    nextId = 1;

    constructor(rows: any[] = []) {
        this.rows = rows;
    }

    async findFirst({ where }: any) {
        return this.rows.find((row) => matchesWhere(row, where)) || null;
    }

    async create({ data }: any) {
        const now = new Date('2026-05-22T00:00:00.000Z');
        const row = {
            id: `watch-${this.nextId++}`,
            created_at: now,
            updated_at: now,
            ...data,
        };
        this.rows.push(row);
        return row;
    }

    async findMany({ where, take }: any) {
        return this.rows.filter((row) => matchesWhere(row, where)).slice(0, take);
    }

    async findUnique({ where }: any) {
        return this.rows.find((row) => row.id === where.id) || null;
    }

    async update({ where, data }: any) {
        const row = this.rows.find((item) => item.id === where.id);
        if (!row) throw new Error('Not found');
        Object.assign(row, data, { updated_at: new Date('2026-05-22T01:00:00.000Z') });
        return row;
    }

    async updateMany({ where, data }: any) {
        let count = 0;
        for (const row of this.rows) {
            if (matchesWhere(row, where)) {
                Object.assign(row, data, { updated_at: new Date('2026-05-22T01:00:00.000Z') });
                count += 1;
            }
        }
        return { count };
    }
}

function fakeDb(rows: any[] = []) {
    return { replyWatch: new FakeReplyWatchModel(rows) };
}

function baseInput(overrides: Record<string, any> = {}) {
    return {
        accountId: 'account-1',
        brandId: 'brand-1',
        leadId: 'lead-1',
        outreachDraftId: 'draft-1',
        platform: 'xiaohongshu',
        sourcePostId: 'post-1',
        sourceCommentId: 'comment-1',
        replyStrategy: 'suitability_advice',
        replyMode: 'advisor_diagnostic',
        productGroundingMode: 'diagnostic_then_product_support',
        buyerStage: 'EVALUATING',
        shouldRedirect: false,
        sentAt: new Date('2026-05-22T00:00:00.000Z'),
        ...overrides,
    };
}

function draftWithGenerationMeta(generationMeta: Record<string, any>, overrides: Record<string, any> = {}) {
    const { draft: draftOverrides = {}, lead: leadOverrides = {}, ...inputOverrides } = overrides;
    return {
        draft: {
            id: 'draft-meta',
            account_id: 'account-1',
            brand_id: 'brand-1',
            lead_id: 'lead-meta',
            platform: 'xiaohongshu',
            cta_target: 'NONE',
            sent_at: new Date('2026-05-22T00:00:00.000Z'),
            generation_meta: generationMeta,
            ...draftOverrides,
        },
        lead: {
            id: 'lead-meta',
            account_id: 'account-1',
            brand_id: 'brand-1',
            platform: 'xiaohongshu',
            video_id: 'post-meta',
            comment_id: 'comment-meta',
            buyer_stage: 'EVALUATING',
            recommended_action: 'DRAFT',
            ...leadOverrides,
        },
        ...inputOverrides,
    };
}

test('should create watch for suitability advice', () => {
    const input = baseInput();

    assert.equal(shouldCreateReplyWatch(input), true);
    assert.equal(getWatchWindowHours(input), 72);
});

test('should not create watch for purchase request with CTA', () => {
    assert.equal(
        shouldCreateReplyWatch(baseInput({
            replyStrategy: 'purchase_request',
            shouldRedirect: true,
            buyerStage: 'READY',
        })),
        false,
    );
});

test('should not create watch for irrelevant low value', () => {
    assert.equal(
        shouldCreateReplyWatch(baseInput({ replyStrategy: 'irrelevant_or_low_value' })),
        false,
    );
});

test('should not create watch for silent capture actions', () => {
    assert.equal(
        shouldCreateReplyWatch(baseInput({ recommendedAction: 'SILENT_CAPTURE' })),
        false,
    );
});

test('dedupes active watches for same account platform and source comment', async () => {
    const db = fakeDb([
        {
            id: 'existing-watch',
            account_id: 'account-1',
            platform: 'xiaohongshu',
            source_comment_id: 'comment-1',
            status: 'WAITING_USER_REPLY',
            watch_until: new Date('2026-05-23T00:00:00.000Z'),
            created_at: new Date('2026-05-22T00:00:00.000Z'),
        },
    ]);

    const watch = await createReplyWatchForSentDraft({ ...baseInput(), db });

    assert.equal(watch.id, 'existing-watch');
    assert.equal(db.replyWatch.rows.length, 1);
});

test('infers product grounding mode from draft reply strategy when metadata is missing', async () => {
    const db = fakeDb();

    const watch = await createReplyWatchForSentDraft({
        ...draftWithGenerationMeta({
            reply_strategy: 'suitability_advice',
            strategy_meta: { should_redirect: false },
        }),
        db,
    });

    assert.equal(watch.product_grounding_mode, 'diagnostic_then_product_support');
});

test('preserves draft metadata product grounding mode when present', async () => {
    const db = fakeDb();

    const watch = await createReplyWatchForSentDraft({
        ...draftWithGenerationMeta({
            reply_strategy: 'suitability_advice',
            strategy_meta: {
                should_redirect: false,
                product_grounding_mode: 'metadata_mode',
            },
        }),
        db,
    });

    assert.equal(watch.product_grounding_mode, 'metadata_mode');
});

test('product grounding mapping does not make non-engagement strategies watchable', async () => {
    for (const replyStrategy of ['purchase_request', 'irrelevant_or_low_value']) {
        const db = fakeDb();

        const watch = await createReplyWatchForSentDraft({
            ...draftWithGenerationMeta({
                reply_strategy: replyStrategy,
                strategy_meta: { should_redirect: false },
            }),
            db,
        });

        assert.equal(watch, null);
        assert.equal(db.replyWatch.rows.length, 0);
    }
});

test('listDueReplyWatches returns only waiting non-expired watches', async () => {
    const now = new Date('2026-05-22T12:00:00.000Z');
    const db = fakeDb([
        {
            id: 'due-1',
            status: 'WAITING_USER_REPLY',
            watch_until: new Date('2026-05-23T00:00:00.000Z'),
            last_checked_at: null,
        },
        {
            id: 'expired',
            status: 'WAITING_USER_REPLY',
            watch_until: new Date('2026-05-22T00:00:00.000Z'),
            last_checked_at: null,
        },
        {
            id: 'closed',
            status: 'CLOSED',
            watch_until: new Date('2026-05-23T00:00:00.000Z'),
            last_checked_at: null,
        },
        {
            id: 'follow-up',
            status: 'FOLLOW_UP_READY',
            watch_until: new Date('2026-05-23T00:00:00.000Z'),
            last_checked_at: null,
        },
    ]);

    const watches = await listDueReplyWatches({ db, now });

    assert.deepEqual(watches.map((watch) => watch.id), ['due-1']);
});

test('mark user replied moves watch to follow up ready', async () => {
    const db = fakeDb([
        {
            id: 'watch-1',
            status: 'WAITING_USER_REPLY',
            metadata: { existing: true },
            last_seen_reply_id: null,
        },
    ]);

    const watch = await markReplyWatchUserReplied({
        db,
        id: 'watch-1',
        replyId: 'reply-1',
        repliedAt: '2026-05-22T03:00:00.000Z',
        engagementEventId: 'event-1',
        metadata: { source: 'test' },
    });

    assert.equal(watch.status, 'FOLLOW_UP_READY');
    assert.equal(watch.last_seen_reply_id, 'reply-1');
    assert.equal(watch.user_replied_at.toISOString(), '2026-05-22T03:00:00.000Z');
    assert.equal(watch.follow_up_ready_at.toISOString(), '2026-05-22T03:00:00.000Z');
    assert.equal(watch.metadata.existing, true);
    assert.equal(watch.metadata.engagement_event_id, 'event-1');
});

test('mark checked updates last checked metadata', async () => {
    const db = fakeDb([
        {
            id: 'watch-checked',
            status: 'WAITING_USER_REPLY',
            last_checked_at: null,
            last_seen_reply_id: null,
        },
    ]);

    const watch = await markReplyWatchChecked({
        db,
        id: 'watch-checked',
        checkedAt: '2026-05-22T04:00:00.000Z',
        lastSeenReplyId: 'reply-2',
    });

    assert.equal(watch.last_checked_at.toISOString(), '2026-05-22T04:00:00.000Z');
    assert.equal(watch.last_seen_reply_id, 'reply-2');
});

test('expireReplyWatches closes expired waiting watches only', async () => {
    const now = new Date('2026-05-22T12:00:00.000Z');
    const db = fakeDb([
        {
            id: 'expired',
            status: 'WAITING_USER_REPLY',
            watch_until: new Date('2026-05-22T00:00:00.000Z'),
        },
        {
            id: 'future',
            status: 'WAITING_USER_REPLY',
            watch_until: new Date('2026-05-23T00:00:00.000Z'),
        },
        {
            id: 'ready',
            status: 'FOLLOW_UP_READY',
            watch_until: new Date('2026-05-22T00:00:00.000Z'),
        },
    ]);

    const count = await expireReplyWatches({ db, now });

    assert.equal(count, 1);
    assert.equal(db.replyWatch.rows[0].status, 'EXPIRED_NO_REPLY');
    assert.equal(db.replyWatch.rows[1].status, 'WAITING_USER_REPLY');
    assert.equal(db.replyWatch.rows[2].status, 'FOLLOW_UP_READY');
});

test('closeReplyWatch marks watch closed', async () => {
    const db = fakeDb([
        {
            id: 'watch-close',
            status: 'WAITING_USER_REPLY',
            closed_at: null,
        },
    ]);

    const watch = await closeReplyWatch({
        db,
        id: 'watch-close',
        closedAt: '2026-05-22T05:00:00.000Z',
    });

    assert.equal(watch.status, 'CLOSED');
    assert.equal(watch.closed_at.toISOString(), '2026-05-22T05:00:00.000Z');
});

test('threadKey fallback allows watch without sourceCommentId', async () => {
    const db = fakeDb();

    const watch = await createReplyWatchForSentDraft({
        ...baseInput({
            sourceCommentId: null,
            sourcePostId: null,
            leadId: 'lead-thread',
        }),
        db,
    });

    assert.equal(watch.thread_key, 'xiaohongshu:lead:lead-thread');
    assert.equal(watch.source_comment_id, null);
});
