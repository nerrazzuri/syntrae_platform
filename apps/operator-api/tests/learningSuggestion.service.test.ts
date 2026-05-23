import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.AI_CORE_INTERNAL_SECRET = process.env.AI_CORE_INTERNAL_SECRET || 'test-internal-secret';

import { createApp } from '../src/index';
import { prisma } from '../src/db';
import {
    generateLearningSuggestions,
    listLearningSuggestions,
    updateLearningSuggestionStatus,
} from '../src/services/learningSuggestion.service';

type RestoreFn = () => void;

function stubMethod<T extends object, K extends keyof T>(target: T, key: K, value: T[K]): RestoreFn {
    const original = target[key];
    Object.defineProperty(target, key, {
        value,
        configurable: true,
        writable: true,
    });
    return () => {
        Object.defineProperty(target, key, {
            value: original,
            configurable: true,
            writable: true,
        });
    };
}

function matchesWhere(row: any, where: Record<string, any> = {}) {
    for (const [key, value] of Object.entries(where || {})) {
        if (value === undefined || value === '') continue;
        if (key === 'created_at') {
            if (value.gte && row.created_at < value.gte) return false;
            if (value.lte && row.created_at > value.lte) return false;
            continue;
        }
        if (row[key] !== value) return false;
    }
    return true;
}

function byId(rows: any[], id: string) {
    return rows.find((row) => row.id === id) || null;
}

class FakeModel {
    rows: any[];
    nextId: number;
    prefix: string;

    constructor(prefix: string, rows: any[] = []) {
        this.prefix = prefix;
        this.rows = rows;
        this.nextId = 1;
    }

    async findUnique({ where }: any) {
        return byId(this.rows, where.id);
    }

    async findMany({ where, orderBy, take }: any = {}) {
        let rows = this.rows.filter((row) => matchesWhere(row, where));
        if (orderBy?.created_at === 'desc') {
            rows = [...rows].sort((a, b) => Number(b.created_at) - Number(a.created_at));
        }
        return typeof take === 'number' ? rows.slice(0, take) : rows;
    }

    async create({ data }: any) {
        const now = new Date('2026-05-22T00:00:00.000Z');
        const row = {
            id: data.id || `${this.prefix}-${this.nextId++}`,
            created_at: now,
            updated_at: now,
            ...data,
        };
        this.rows.push(row);
        return row;
    }

    async update({ where, data }: any) {
        const row = byId(this.rows, where.id);
        if (!row) throw new Error('Not found');
        Object.assign(row, data, {
            updated_at: new Date('2026-05-22T01:00:00.000Z'),
        });
        return row;
    }
}

function feedback(overrides: Record<string, any> = {}) {
    return {
        id: overrides.id || 'feedback-1',
        account_id: 'account-1',
        brand_id: 'brand-1',
        outreach_draft_id: 'draft-1',
        reply_watch_id: null,
        platform: 'xiaohongshu',
        feedback_type: 'REJECTED',
        selected_reasons: ['TOO_AI'],
        original_draft_text: '欢迎访问我们的店铺探索更多选择',
        human_edited_text: null,
        final_sent_text: null,
        reply_strategy: 'suitability_advice',
        product_grounding_mode: 'diagnostic_then_product_support',
        buyer_stage: 'EVALUATING',
        qc_status: { passed: false },
        created_at: new Date('2026-05-22T00:00:00.000Z'),
        ...overrides,
    };
}

function rowsWithReason(reason: string, count = 3, overrides: Record<string, any> = {}) {
    return Array.from({ length: count }, (_, index) =>
        feedback({
            id: `${reason}-${index}`,
            selected_reasons: [reason],
            ...overrides,
        }),
    );
}

function rowsWithReasonPrefix(reason: string, count: number, prefix: string, overrides: Record<string, any> = {}) {
    return rowsWithReason(reason, count, overrides).map((row, index) => ({
        ...row,
        id: `${prefix}-${index}`,
    }));
}

function makeDb(feedbackRows: any[] = [], suggestionRows: any[] = []) {
    return {
        draftFeedback: new FakeModel('feedback', feedbackRows),
        learningSuggestion: new FakeModel('suggestion', suggestionRows),
    };
}

async function suggestionDraftFor(feedbackRows: any[], index = 0) {
    const db = makeDb(feedbackRows);
    const result = await generateLearningSuggestions({
        db,
        accountId: 'account-1',
        dryRun: true,
    });
    return result.suggestions[index];
}

function duplicateSuggestionFrom(draft: any, overrides: Record<string, any> = {}) {
    return {
        id: overrides.id || 'duplicate-suggestion',
        created_at: new Date('2026-05-21T00:00:00.000Z'),
        updated_at: new Date('2026-05-21T00:00:00.000Z'),
        ...draft,
        status: overrides.status || 'OPEN',
        message: overrides.message || 'stale message',
        evidence: overrides.evidence || { stale: true },
        source_feedback_ids: overrides.source_feedback_ids || ['stale-feedback-id'],
        metadata: {
            ...(draft.metadata || {}),
            ...(overrides.metadata || {}),
        },
        reviewed_by: overrides.reviewed_by,
        reviewed_at: overrides.reviewed_at,
        review_note: overrides.review_note,
    };
}

test('dry-run generates no persisted records', async () => {
    const db = makeDb(rowsWithReason('TOO_AI'));

    const result = await generateLearningSuggestions({
        db,
        accountId: 'account-1',
        dryRun: true,
    });

    assert.equal(result.suggestions.length, 1);
    assert.equal(result.persisted_count, 0);
    assert.equal(db.learningSuggestion.rows.length, 0);
});

test('TOO_AI insight creates PROMPT_STYLE_REVIEW', async () => {
    const db = makeDb(rowsWithReason('TOO_AI'));

    const result = await generateLearningSuggestions({ db, accountId: 'account-1', dryRun: true });

    assert.equal(result.suggestions[0].suggestion_type, 'PROMPT_STYLE_REVIEW');
});

test('TOO_SALESY and CTA_SHOULD_NOT_BE_INCLUDED create CTA_GATING_REVIEW', async () => {
    const db = makeDb([
        ...rowsWithReason('TOO_SALESY', 2),
        ...rowsWithReason('CTA_SHOULD_NOT_BE_INCLUDED', 1),
    ]);

    const result = await generateLearningSuggestions({ db, accountId: 'account-1', dryRun: true });

    assert.equal(result.suggestions[0].suggestion_type, 'CTA_GATING_REVIEW');
});

test('WRONG_INTENT creates INTENT_MAPPING_REVIEW', async () => {
    const db = makeDb(rowsWithReason('WRONG_INTENT'));

    const result = await generateLearningSuggestions({ db, accountId: 'account-1', dryRun: true });

    assert.equal(result.suggestions[0].suggestion_type, 'INTENT_MAPPING_REVIEW');
});

test('PRODUCT_INFO_WRONG creates PRODUCT_GROUNDING_REVIEW', async () => {
    const db = makeDb(rowsWithReason('PRODUCT_INFO_WRONG'));

    const result = await generateLearningSuggestions({ db, accountId: 'account-1', dryRun: true });

    assert.equal(result.suggestions[0].suggestion_type, 'PRODUCT_GROUNDING_REVIEW');
});

test('QC-passed rejected creates DRAFT_QC_RULE_REVIEW', async () => {
    const db = makeDb(rowsWithReason('TOO_AI', 3, { qc_status: { passed: true } }));

    const result = await generateLearningSuggestions({ db, accountId: 'account-1', dryRun: true });

    assert.ok(result.suggestions.some((s: any) => s.suggestion_type === 'DRAFT_QC_RULE_REVIEW'));
});

test('follow-up rejection higher than first-draft creates FOLLOW_UP_PROMPT_REVIEW', async () => {
    const db = makeDb([
        feedback({ id: 'f1', feedback_type: 'ACCEPTED_AS_IS', selected_reasons: [] }),
        feedback({ id: 'f2', feedback_type: 'ACCEPTED_AS_IS', selected_reasons: [] }),
        feedback({ id: 'f3', reply_watch_id: 'watch-1', feedback_type: 'REJECTED' }),
        feedback({ id: 'f4', reply_watch_id: 'watch-2', feedback_type: 'REJECTED' }),
    ]);

    const result = await generateLearningSuggestions({ db, accountId: 'account-1', dryRun: true });

    assert.ok(result.suggestions.some((s: any) => s.suggestion_type === 'FOLLOW_UP_PROMPT_REVIEW'));
});

test('NOT_BRAND_VOICE creates BRAND_PROFILE_REVIEW', async () => {
    const db = makeDb(rowsWithReason('NOT_BRAND_VOICE'));

    const result = await generateLearningSuggestions({ db, accountId: 'account-1', dryRun: true });

    assert.equal(result.suggestions[0].suggestion_type, 'BRAND_PROFILE_REVIEW');
});

test('persists suggestions when dryRun is false', async () => {
    const db = makeDb(rowsWithReason('TOO_AI'));

    const result = await generateLearningSuggestions({
        db,
        accountId: 'account-1',
        dryRun: false,
    });

    assert.equal(result.persisted_count, 1);
    assert.equal(result.refreshed_count, 0);
    assert.equal(db.learningSuggestion.rows.length, 1);
});

test('refreshes duplicate OPEN suggestions using evidence signature', async () => {
    const db = makeDb(rowsWithReason('TOO_AI'));
    await generateLearningSuggestions({ db, accountId: 'account-1', dryRun: false });

    db.draftFeedback.rows = rowsWithReasonPrefix('TOO_AI', 4, 'latest-feedback');
    const result = await generateLearningSuggestions({
        db,
        accountId: 'account-1',
        dryRun: false,
    });

    assert.equal(result.persisted_count, 0);
    assert.equal(result.refreshed_count, 1);
    assert.equal(result.skipped_duplicate_count, 0);
    assert.equal(db.learningSuggestion.rows.length, 1);
    assert.equal(db.learningSuggestion.rows[0].evidence.too_ai_count, 4);
});

test('refreshed suggestion gets updated evidence and message', async () => {
    const draft = await suggestionDraftFor(rowsWithReason('TOO_AI'));
    const db = makeDb(rowsWithReason('TOO_AI', 5), [
        duplicateSuggestionFrom(draft, {
            evidence: { selected_reason: 'TOO_AI', too_ai_count: 1 },
            message: 'old stale message',
        }),
    ]);

    const result = await generateLearningSuggestions({
        db,
        accountId: 'account-1',
        dryRun: false,
    });

    assert.equal(result.refreshed_count, 1);
    assert.equal(result.suggestions[0].id, 'duplicate-suggestion');
    assert.equal(result.suggestions[0].evidence.too_ai_count, 5);
    assert.notEqual(result.suggestions[0].message, 'old stale message');
});

test('refreshed suggestion replaces source feedback ids with latest samples', async () => {
    const draft = await suggestionDraftFor(rowsWithReasonPrefix('TOO_AI', 3, 'old-feedback'));
    const latestRows = rowsWithReasonPrefix('TOO_AI', 4, 'latest-feedback');
    const db = makeDb(latestRows, [
        duplicateSuggestionFrom(draft, {
            source_feedback_ids: ['old-feedback-1'],
        }),
    ]);

    await generateLearningSuggestions({
        db,
        accountId: 'account-1',
        dryRun: false,
    });

    assert.deepEqual(
        db.learningSuggestion.rows[0].source_feedback_ids,
        latestRows.map((row) => row.id),
    );
});

test('refreshed suggestion increments refresh metadata', async () => {
    const draft = await suggestionDraftFor(rowsWithReason('TOO_AI'));
    const db = makeDb(rowsWithReason('TOO_AI', 4), [
        duplicateSuggestionFrom(draft, {
            metadata: { refresh_count: 2 },
        }),
    ]);

    await generateLearningSuggestions({
        db,
        accountId: 'account-1',
        dryRun: false,
    });

    const metadata = db.learningSuggestion.rows[0].metadata;
    assert.equal(metadata.refresh_count, 3);
    assert.equal(metadata.last_refresh_reason, 'duplicate_open_suggestion_evidence_refresh');
    assert.ok(metadata.refreshed_at);
    assert.equal(metadata.evidence_signature, draft.metadata.evidence_signature);
});

test('ACCEPTED duplicate is skipped and not refreshed', async () => {
    const draft = await suggestionDraftFor(rowsWithReason('TOO_AI'));
    const db = makeDb(rowsWithReason('TOO_AI', 4), [
        duplicateSuggestionFrom(draft, {
            status: 'ACCEPTED',
            evidence: { selected_reason: 'TOO_AI', too_ai_count: 1 },
        }),
    ]);

    const result = await generateLearningSuggestions({
        db,
        accountId: 'account-1',
        dryRun: false,
    });

    assert.equal(result.persisted_count, 0);
    assert.equal(result.refreshed_count, 0);
    assert.equal(result.skipped_duplicate_count, 1);
    assert.equal(db.learningSuggestion.rows[0].status, 'ACCEPTED');
    assert.equal(db.learningSuggestion.rows[0].evidence.too_ai_count, 1);
});

test('REJECTED duplicate is skipped and not refreshed', async () => {
    const draft = await suggestionDraftFor(rowsWithReason('TOO_AI'));
    const db = makeDb(rowsWithReason('TOO_AI', 4), [
        duplicateSuggestionFrom(draft, {
            status: 'REJECTED',
            evidence: { selected_reason: 'TOO_AI', too_ai_count: 1 },
        }),
    ]);

    const result = await generateLearningSuggestions({
        db,
        accountId: 'account-1',
        dryRun: false,
    });

    assert.equal(result.persisted_count, 0);
    assert.equal(result.refreshed_count, 0);
    assert.equal(result.skipped_duplicate_count, 1);
    assert.equal(db.learningSuggestion.rows[0].status, 'REJECTED');
    assert.equal(db.learningSuggestion.rows[0].evidence.too_ai_count, 1);
});

test('ARCHIVED duplicate is skipped and not refreshed', async () => {
    const draft = await suggestionDraftFor(rowsWithReason('TOO_AI'));
    const db = makeDb(rowsWithReason('TOO_AI', 4), [
        duplicateSuggestionFrom(draft, {
            status: 'ARCHIVED',
            evidence: { selected_reason: 'TOO_AI', too_ai_count: 1 },
        }),
    ]);

    const result = await generateLearningSuggestions({
        db,
        accountId: 'account-1',
        dryRun: false,
    });

    assert.equal(result.persisted_count, 0);
    assert.equal(result.refreshed_count, 0);
    assert.equal(result.skipped_duplicate_count, 1);
    assert.equal(db.learningSuggestion.rows[0].status, 'ARCHIVED');
    assert.equal(db.learningSuggestion.rows[0].evidence.too_ai_count, 1);
});

test('persisted count includes only new records when another suggestion refreshes', async () => {
    const rows = [
        ...rowsWithReason('TOO_AI', 3),
        ...rowsWithReason('WRONG_INTENT', 3),
    ];
    const tooAiDraft = await suggestionDraftFor(rowsWithReason('TOO_AI'));
    const db = makeDb(rows, [duplicateSuggestionFrom(tooAiDraft)]);

    const result = await generateLearningSuggestions({
        db,
        accountId: 'account-1',
        dryRun: false,
    });

    assert.equal(result.persisted_count, 1);
    assert.equal(result.refreshed_count, 1);
    assert.equal(result.skipped_duplicate_count, 0);
    assert.equal(db.learningSuggestion.rows.length, 2);
});

test('skipped duplicate count includes non-refreshable duplicates while new records persist', async () => {
    const rows = [
        ...rowsWithReason('TOO_AI', 3),
        ...rowsWithReason('WRONG_INTENT', 3),
    ];
    const tooAiDraft = await suggestionDraftFor(rowsWithReason('TOO_AI'));
    const db = makeDb(rows, [duplicateSuggestionFrom(tooAiDraft, { status: 'ACCEPTED' })]);

    const result = await generateLearningSuggestions({
        db,
        accountId: 'account-1',
        dryRun: false,
    });

    assert.equal(result.persisted_count, 1);
    assert.equal(result.refreshed_count, 0);
    assert.equal(result.skipped_duplicate_count, 1);
    assert.equal(db.learningSuggestion.rows.length, 2);
});

test('lists suggestions by account scope', async () => {
    const db = makeDb([], [
        { id: 's1', account_id: 'account-1', status: 'OPEN', suggestion_type: 'PROMPT_STYLE_REVIEW' },
        { id: 's2', account_id: 'account-2', status: 'OPEN', suggestion_type: 'PROMPT_STYLE_REVIEW' },
    ]);

    const rows = await listLearningSuggestions({ db, accountId: 'account-1' });

    assert.deepEqual(rows.map((row: any) => row.id), ['s1']);
});

test('filters suggestions by brand platform status and type', async () => {
    const db = makeDb([], [
        {
            id: 's1',
            account_id: 'account-1',
            brand_id: 'brand-1',
            platform: 'xiaohongshu',
            status: 'OPEN',
            suggestion_type: 'CTA_GATING_REVIEW',
        },
        {
            id: 's2',
            account_id: 'account-1',
            brand_id: 'brand-2',
            platform: 'instagram',
            status: 'REJECTED',
            suggestion_type: 'PROMPT_STYLE_REVIEW',
        },
    ]);

    const rows = await listLearningSuggestions({
        db,
        accountId: 'account-1',
        brandId: 'brand-1',
        platform: 'xiaohongshu',
        status: 'OPEN',
        suggestionType: 'CTA_GATING_REVIEW',
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 's1');
});

test('updates OPEN to ACCEPTED', async () => {
    const db = makeDb([], [{ id: 's1', account_id: 'account-1', status: 'OPEN' }]);

    const row = await updateLearningSuggestionStatus({
        db,
        accountId: 'account-1',
        suggestionId: 's1',
        status: 'ACCEPTED',
        reviewedBy: 'user-1',
        reviewNote: 'Looks right',
    });

    assert.equal(row.status, 'ACCEPTED');
    assert.equal(row.reviewed_by, 'user-1');
});

test('updates OPEN to REJECTED', async () => {
    const db = makeDb([], [{ id: 's1', account_id: 'account-1', status: 'OPEN' }]);

    const row = await updateLearningSuggestionStatus({
        db,
        accountId: 'account-1',
        suggestionId: 's1',
        status: 'REJECTED',
    });

    assert.equal(row.status, 'REJECTED');
});

test('rejects invalid transition REJECTED to ACCEPTED', async () => {
    const db = makeDb([], [{ id: 's1', account_id: 'account-1', status: 'REJECTED' }]);

    await assert.rejects(
        () =>
            updateLearningSuggestionStatus({
                db,
                accountId: 'account-1',
                suggestionId: 's1',
                status: 'ACCEPTED',
            }),
        /Invalid learning suggestion status transition/,
    );
});

test('rejects cross-account access', async () => {
    const db = makeDb([], [{ id: 's1', account_id: 'account-2', status: 'OPEN' }]);

    await assert.rejects(
        () =>
            updateLearningSuggestionStatus({
                db,
                accountId: 'account-1',
                suggestionId: 's1',
                status: 'ACCEPTED',
            }),
        /scope mismatch/,
    );
});

test('internal route generate returns suggestions', async (t) => {
    const restores: RestoreFn[] = [];
    t.after(() => restores.reverse().forEach((restore) => restore()));
    restores.push(stubMethod(prisma.draftFeedback, 'findMany', (async () => rowsWithReason('TOO_AI')) as any));

    const app = createApp();
    const res = await request(app)
        .post('/internal/learning-suggestions/generate')
        .set('x-internal-secret', process.env.AI_CORE_INTERNAL_SECRET!)
        .send({ account_id: 'account-1', dry_run: true });

    assert.equal(res.status, 200);
    assert.equal(res.body.persisted_count, 0);
    assert.equal(res.body.suggestions[0].suggestion_type, 'PROMPT_STYLE_REVIEW');
});

test('internal route status update works', async (t) => {
    const restores: RestoreFn[] = [];
    t.after(() => restores.reverse().forEach((restore) => restore()));
    const row = { id: 's1', account_id: 'account-1', status: 'OPEN' };
    restores.push(stubMethod(prisma as any, 'learningSuggestion', {
        findUnique: async () => row,
        update: async ({ data }: any) => ({
            ...row,
            ...data,
        }),
    } as any));

    const app = createApp();
    const res = await request(app)
        .post('/internal/learning-suggestions/s1/status')
        .set('x-internal-secret', process.env.AI_CORE_INTERNAL_SECRET!)
        .send({ account_id: 'account-1', status: 'ACCEPTED', reviewed_by: 'user-1' });

    assert.equal(res.status, 200);
    assert.equal(res.body.suggestion.status, 'ACCEPTED');
    assert.equal(res.body.suggestion.reviewed_by, 'user-1');
});

// --- P9.6-D: GENERIC_REPLY_REVIEW ---

test('TOO_GENERIC high creates GENERIC_REPLY_REVIEW', async () => {
    const db = makeDb(rowsWithReason('TOO_GENERIC'));

    const result = await generateLearningSuggestions({ db, accountId: 'account-1', dryRun: true });

    assert.ok(result.suggestions.some((s: any) => s.suggestion_type === 'GENERIC_REPLY_REVIEW'));
});

test('GENERIC_REPLY_REVIEW message includes count and total', async () => {
    const db = makeDb(rowsWithReason('TOO_GENERIC', 5));

    const result = await generateLearningSuggestions({ db, accountId: 'account-1', dryRun: true });

    const s = result.suggestions.find((s: any) => s.suggestion_type === 'GENERIC_REPLY_REVIEW');
    assert.ok(s, 'GENERIC_REPLY_REVIEW suggestion not found');
    assert.match(s.message, /5/);
    assert.match(s.message, /5/);
});

test('GENERIC_REPLY_REVIEW proposed_action mentions reducing generic reusable advice', async () => {
    const s = await suggestionDraftFor(rowsWithReason('TOO_GENERIC'));

    const actions: string[] = s.proposed_action.actions;
    assert.ok(
        actions.some((a) => /generic/i.test(a) && /reusable/i.test(a)),
        `No action about reducing generic reusable advice. Got: ${JSON.stringify(actions)}`,
    );
});

test('GENERIC_REPLY_REVIEW severity is HIGH when count/total >= 0.4', async () => {
    // 3/3 = 100% >= 40%
    const s = await suggestionDraftFor(rowsWithReason('TOO_GENERIC', 3));

    assert.equal(s.suggestion_type, 'GENERIC_REPLY_REVIEW');
    assert.equal(s.severity, 'HIGH');
});

test('GENERIC_REPLY_REVIEW severity is MEDIUM when count/total < 0.4 and count < 10', async () => {
    // 3 TOO_GENERIC out of 13 total: 3/13 ≈ 23% < 40%, 3 < 10 → MEDIUM
    const rows = [
        ...rowsWithReason('TOO_GENERIC', 3),
        ...rowsWithReason('GOOD_REPLY', 10),
    ];
    const db = makeDb(rows);
    const result = await generateLearningSuggestions({ db, accountId: 'account-1', dryRun: true });

    const s = result.suggestions.find((s: any) => s.suggestion_type === 'GENERIC_REPLY_REVIEW');
    assert.ok(s, 'GENERIC_REPLY_REVIEW suggestion not found');
    assert.equal(s.severity, 'MEDIUM');
});

test('GENERIC_REPLY_REVIEW deduplicates by evidence signature', async () => {
    const draft = await suggestionDraftFor(rowsWithReason('TOO_GENERIC'));
    const db = makeDb(rowsWithReason('TOO_GENERIC'), [duplicateSuggestionFrom(draft)]);

    const result = await generateLearningSuggestions({ db, accountId: 'account-1', dryRun: false });

    assert.equal(result.persisted_count, 0);
    assert.equal(result.refreshed_count, 1);
    assert.equal(db.learningSuggestion.rows.length, 1);
});

test('duplicate OPEN GENERIC_REPLY_REVIEW refreshes with updated evidence', async () => {
    const draft = await suggestionDraftFor(rowsWithReason('TOO_GENERIC', 3));
    const db = makeDb(rowsWithReason('TOO_GENERIC', 6), [
        duplicateSuggestionFrom(draft, {
            evidence: { selected_reason: 'TOO_GENERIC', too_generic_count: 1 },
            message: 'old generic message',
        }),
    ]);

    const result = await generateLearningSuggestions({ db, accountId: 'account-1', dryRun: false });

    assert.equal(result.refreshed_count, 1);
    assert.equal(result.suggestions[0].evidence.too_generic_count, 6);
    assert.notEqual(result.suggestions[0].message, 'old generic message');
    assert.match(result.suggestions[0].message, /6/);
});

test('non-OPEN GENERIC_REPLY_REVIEW duplicate is skipped', async () => {
    const draft = await suggestionDraftFor(rowsWithReason('TOO_GENERIC'));
    const db = makeDb(rowsWithReason('TOO_GENERIC', 4), [
        duplicateSuggestionFrom(draft, { status: 'ACCEPTED' }),
    ]);

    const result = await generateLearningSuggestions({ db, accountId: 'account-1', dryRun: false });

    assert.equal(result.persisted_count, 0);
    assert.equal(result.refreshed_count, 0);
    assert.equal(result.skipped_duplicate_count, 1);
    assert.equal(db.learningSuggestion.rows[0].status, 'ACCEPTED');
});

// --- P9.6-D: MISSED_USER_QUESTION_REVIEW ---

test('MISSED_USER_QUESTION high creates MISSED_USER_QUESTION_REVIEW', async () => {
    const db = makeDb(rowsWithReason('MISSED_USER_QUESTION'));

    const result = await generateLearningSuggestions({ db, accountId: 'account-1', dryRun: true });

    assert.ok(result.suggestions.some((s: any) => s.suggestion_type === 'MISSED_USER_QUESTION_REVIEW'));
});

test('MISSED_USER_QUESTION_REVIEW message includes count and total', async () => {
    const db = makeDb(rowsWithReason('MISSED_USER_QUESTION', 5));

    const result = await generateLearningSuggestions({ db, accountId: 'account-1', dryRun: true });

    const s = result.suggestions.find((s: any) => s.suggestion_type === 'MISSED_USER_QUESTION_REVIEW');
    assert.ok(s, 'MISSED_USER_QUESTION_REVIEW suggestion not found');
    assert.match(s.message, /5/);
});

test('MISSED_USER_QUESTION_REVIEW proposed_action mentions answering exact user question first', async () => {
    const s = await suggestionDraftFor(rowsWithReason('MISSED_USER_QUESTION'));

    const actions: string[] = s.proposed_action.actions;
    assert.ok(
        actions.some((a) => /exact/i.test(a) || /direct/i.test(a) || /answer/i.test(a)),
        `No action about answering exact user question. Got: ${JSON.stringify(actions)}`,
    );
});

test('MISSED_USER_QUESTION_REVIEW severity is HIGH when count/total >= 0.25', async () => {
    // 3/3 = 100% >= 25%
    const s = await suggestionDraftFor(rowsWithReason('MISSED_USER_QUESTION', 3));

    assert.equal(s.suggestion_type, 'MISSED_USER_QUESTION_REVIEW');
    assert.equal(s.severity, 'HIGH');
});

test('MISSED_USER_QUESTION_REVIEW severity is MEDIUM when count/total < 0.25 and count < 10', async () => {
    // 3 MISSED out of 13 total: 3/13 ≈ 23% < 25%, 3 < 10 → MEDIUM
    const rows = [
        ...rowsWithReason('MISSED_USER_QUESTION', 3),
        ...rowsWithReason('GOOD_REPLY', 10),
    ];
    const db = makeDb(rows);
    const result = await generateLearningSuggestions({ db, accountId: 'account-1', dryRun: true });

    const s = result.suggestions.find((s: any) => s.suggestion_type === 'MISSED_USER_QUESTION_REVIEW');
    assert.ok(s, 'MISSED_USER_QUESTION_REVIEW suggestion not found');
    assert.equal(s.severity, 'MEDIUM');
});

test('duplicate OPEN MISSED_USER_QUESTION_REVIEW refreshes with updated evidence', async () => {
    const draft = await suggestionDraftFor(rowsWithReason('MISSED_USER_QUESTION', 3));
    const db = makeDb(rowsWithReason('MISSED_USER_QUESTION', 6), [
        duplicateSuggestionFrom(draft, {
            evidence: { selected_reason: 'MISSED_USER_QUESTION', missed_user_question_count: 1 },
            message: 'old missed question message',
        }),
    ]);

    const result = await generateLearningSuggestions({ db, accountId: 'account-1', dryRun: false });

    assert.equal(result.refreshed_count, 1);
    assert.equal(result.suggestions[0].evidence.missed_user_question_count, 6);
    assert.notEqual(result.suggestions[0].message, 'old missed question message');
    assert.match(result.suggestions[0].message, /6/);
});

test('non-OPEN MISSED_USER_QUESTION_REVIEW duplicate is skipped', async () => {
    const draft = await suggestionDraftFor(rowsWithReason('MISSED_USER_QUESTION'));
    const db = makeDb(rowsWithReason('MISSED_USER_QUESTION', 4), [
        duplicateSuggestionFrom(draft, { status: 'REJECTED' }),
    ]);

    const result = await generateLearningSuggestions({ db, accountId: 'account-1', dryRun: false });

    assert.equal(result.persisted_count, 0);
    assert.equal(result.refreshed_count, 0);
    assert.equal(result.skipped_duplicate_count, 1);
    assert.equal(db.learningSuggestion.rows[0].status, 'REJECTED');
});
