import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getDraftFeedbackSummary,
    listDraftFeedbackForDraft,
    recordDraftFeedback,
} from '../src/services/draftFeedback.service';

function byId(rows: any[], id: string) {
    return rows.find((row) => row.id === id) || null;
}

function matchesWhere(row: any, where: Record<string, any> = {}) {
    for (const [key, value] of Object.entries(where)) {
        if (value === undefined || value === '') continue;
        if (row[key] !== value) return false;
    }
    return true;
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

    async findMany({ where, orderBy }: any = {}) {
        const rows = this.rows.filter((row) => matchesWhere(row, where));
        if (orderBy?.created_at === 'desc') {
            return [...rows].sort(
                (a, b) => Number(b.created_at) - Number(a.created_at),
            );
        }
        return rows;
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

function makeDraft(overrides: Record<string, any> = {}) {
    return {
        id: 'draft-1',
        account_id: 'account-1',
        brand_id: 'brand-1',
        lead_id: 'lead-1',
        platform: 'xiaohongshu',
        buyer_stage: 'EVALUATING',
        draft_text: '不是你不适合猫眼，主要是这副框偏大。',
        edited_text: null,
        generation_meta: {
            reply_strategy: 'suitability_advice',
            strategy_meta: {
                reply_mode: 'advisor_diagnostic',
                product_grounding_mode: 'diagnostic_then_product_support',
            },
            qc_status: { passed: true, score: 1, flags: [] },
            intent: 'FIT_SUITABILITY',
        },
        ...overrides,
    };
}

function makeDb(overrides: Record<string, any> = {}) {
    return {
        outreachDraft: new FakeModel('draft', [
            makeDraft(overrides.draft || {}),
            ...(overrides.extraDrafts || []),
        ]),
        draftFeedback: new FakeModel('feedback', overrides.feedback || []),
    };
}

test('records ACCEPTED_AS_IS feedback for normal draft', async () => {
    const db = makeDb();

    const feedback = await recordDraftFeedback({
        db,
        accountId: 'account-1',
        outreachDraftId: 'draft-1',
        feedbackType: 'ACCEPTED_AS_IS',
        selectedReasons: ['GOOD_REPLY'],
    });

    assert.equal(feedback.feedback_type, 'ACCEPTED_AS_IS');
    assert.equal(feedback.original_draft_text, '不是你不适合猫眼，主要是这副框偏大。');
    assert.deepEqual(feedback.selected_reasons, ['GOOD_REPLY']);
    assert.equal(db.outreachDraft.rows[0].generation_meta.latest_feedback_id, feedback.id);
});

test('records EDITED_BEFORE_SEND with human edited text', async () => {
    const db = makeDb();

    const feedback = await recordDraftFeedback({
        db,
        outreachDraftId: 'draft-1',
        feedbackType: 'EDITED_BEFORE_SEND',
        humanEditedText: '更适合小一点、边角柔和的猫眼。',
        finalSentText: '更适合小一点、边角柔和的猫眼。',
        selectedReasons: ['TOO_LONG'],
    });

    assert.equal(feedback.feedback_type, 'EDITED_BEFORE_SEND');
    assert.equal(feedback.human_edited_text, '更适合小一点、边角柔和的猫眼。');
    assert.equal(feedback.final_sent_text, '更适合小一点、边角柔和的猫眼。');
});

test('records REJECTED with selected reasons', async () => {
    const db = makeDb();

    const feedback = await recordDraftFeedback({
        db,
        outreachDraftId: 'draft-1',
        feedbackType: 'REJECTED',
        feedbackNote: 'Still sounds too generic.',
        selectedReasons: ['TOO_AI', 'TOO_SALESY'],
    });

    assert.equal(feedback.feedback_type, 'REJECTED');
    assert.equal(feedback.feedback_note, 'Still sounds too generic.');
    assert.deepEqual(feedback.selected_reasons, ['TOO_AI', 'TOO_SALESY']);
});

test('enforces account scope', async () => {
    const db = makeDb();

    await assert.rejects(
        () =>
            recordDraftFeedback({
                db,
                accountId: 'account-2',
                outreachDraftId: 'draft-1',
                feedbackType: 'ACCEPTED_AS_IS',
            }),
        /scope mismatch/,
    );
});

test('extracts reply strategy metadata from generation_meta', async () => {
    const db = makeDb();

    const feedback = await recordDraftFeedback({
        db,
        outreachDraftId: 'draft-1',
        feedbackType: 'ACCEPTED_AS_IS',
    });

    assert.equal(feedback.reply_strategy, 'suitability_advice');
    assert.equal(feedback.reply_mode, 'advisor_diagnostic');
    assert.equal(feedback.product_grounding_mode, 'diagnostic_then_product_support');
    assert.equal(feedback.intent, 'FIT_SUITABILITY');
    assert.deepEqual(feedback.qc_status, { passed: true, score: 1, flags: [] });
});

test('extracts follow-up reply watch id from generation_meta', async () => {
    const db = makeDb({
        draft: {
            generation_meta: {
                reply_strategy: 'purchase_request',
                reply_watch_id: 'watch-1',
                previous_draft_id: 'draft-original',
                strategy_meta: {
                    reply_mode: 'answer_then_soft_cta',
                    product_grounding_mode: 'product_first',
                },
            },
        },
    });

    const feedback = await recordDraftFeedback({
        db,
        outreachDraftId: 'draft-1',
        feedbackType: 'EDITED_BEFORE_SEND',
        selectedReasons: ['CTA_MISSING'],
    });

    assert.equal(feedback.reply_watch_id, 'watch-1');
    assert.equal(feedback.metadata.parent_outreach_draft_id, 'draft-original');
    assert.equal(feedback.reply_strategy, 'purchase_request');
});

test('rejects missing outreach draft id', async () => {
    const db = makeDb();

    await assert.rejects(
        () =>
            recordDraftFeedback({
                db,
                outreachDraftId: '',
                feedbackType: 'ACCEPTED_AS_IS',
            }),
        /outreachDraftId is required/,
    );
});

test('rejects invalid feedback type', async () => {
    const db = makeDb();

    await assert.rejects(
        () =>
            recordDraftFeedback({
                db,
                outreachDraftId: 'draft-1',
                feedbackType: 'BAD_TYPE',
            }),
        /Invalid feedbackType/,
    );
});

test('lists feedback records for draft', async () => {
    const db = makeDb();
    await recordDraftFeedback({
        db,
        outreachDraftId: 'draft-1',
        feedbackType: 'ACCEPTED_AS_IS',
    });
    await recordDraftFeedback({
        db,
        outreachDraftId: 'draft-1',
        feedbackType: 'NEEDS_REWRITE',
        selectedReasons: ['TOO_SHORT'],
    });

    const rows = await listDraftFeedbackForDraft({
        db,
        accountId: 'account-1',
        outreachDraftId: 'draft-1',
    });

    assert.equal(rows.length, 2);
    assert.equal(rows[0].outreach_draft_id, 'draft-1');
});

test('summary returns counts by feedback type and selected reasons', async () => {
    const db = makeDb();
    await recordDraftFeedback({
        db,
        outreachDraftId: 'draft-1',
        feedbackType: 'ACCEPTED_AS_IS',
        selectedReasons: ['GOOD_REPLY'],
    });
    await recordDraftFeedback({
        db,
        outreachDraftId: 'draft-1',
        feedbackType: 'REJECTED',
        selectedReasons: ['TOO_AI', 'TOO_SALESY'],
    });
    await recordDraftFeedback({
        db,
        outreachDraftId: 'draft-1',
        feedbackType: 'REJECTED',
        selectedReasons: ['TOO_AI'],
    });

    const summary = await getDraftFeedbackSummary({
        db,
        brandId: 'brand-1',
    });

    assert.equal(summary.total, 3);
    assert.equal(summary.by_feedback_type.ACCEPTED_AS_IS, 1);
    assert.equal(summary.by_feedback_type.REJECTED, 2);
    assert.equal(summary.top_selected_reasons.TOO_AI, 2);
    assert.equal(summary.top_selected_reasons.TOO_SALESY, 1);
});
