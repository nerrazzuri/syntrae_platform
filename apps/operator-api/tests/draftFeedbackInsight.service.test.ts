import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildFeedbackRecommendations,
    getDraftFeedbackInsights,
} from '../src/services/draftFeedbackInsight.service';

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

class FakeDraftFeedbackModel {
    rows: any[];

    constructor(rows: any[]) {
        this.rows = rows;
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
}

function makeDb(rows: any[]) {
    return {
        draftFeedback: new FakeDraftFeedbackModel(rows),
    };
}

function feedback(overrides: Record<string, any> = {}) {
    return {
        id: overrides.id || 'feedback-1',
        account_id: 'account-1',
        brand_id: 'brand-1',
        lead_id: 'lead-1',
        outreach_draft_id: 'draft-1',
        reply_watch_id: null,
        platform: 'xiaohongshu',
        feedback_type: 'ACCEPTED_AS_IS',
        selected_reasons: [],
        original_draft_text: '自然具体的回复',
        human_edited_text: null,
        final_sent_text: null,
        reply_strategy: 'suitability_advice',
        reply_mode: 'advisor_diagnostic',
        product_grounding_mode: 'diagnostic_then_product_support',
        buyer_stage: 'EVALUATING',
        qc_status: { passed: true, score: 1, flags: [] },
        created_at: new Date('2026-05-22T00:00:00.000Z'),
        ...overrides,
    };
}

test('returns empty insight structure when no feedback exists', async () => {
    const insights = await getDraftFeedbackInsights({ db: makeDb([]) });

    assert.equal(insights.total_feedback, 0);
    assert.deepEqual(insights.by_feedback_type, {});
    assert.equal(insights.acceptance_rate, 0);
    assert.deepEqual(insights.rejected_examples, []);
});

test('aggregates by feedback type', async () => {
    const insights = await getDraftFeedbackInsights({
        db: makeDb([
            feedback({ id: 'f1', feedback_type: 'ACCEPTED_AS_IS' }),
            feedback({ id: 'f2', feedback_type: 'REJECTED' }),
            feedback({ id: 'f3', feedback_type: 'REJECTED' }),
        ]),
    });

    assert.equal(insights.by_feedback_type.ACCEPTED_AS_IS, 1);
    assert.equal(insights.by_feedback_type.REJECTED, 2);
});

test('aggregates selected reasons', async () => {
    const insights = await getDraftFeedbackInsights({
        db: makeDb([
            feedback({ id: 'f1', selected_reasons: ['TOO_AI', 'TOO_SALESY'] }),
            feedback({ id: 'f2', selected_reasons: ['TOO_AI'] }),
        ]),
    });

    assert.equal(insights.by_selected_reason.TOO_AI, 2);
    assert.equal(insights.by_selected_reason.TOO_SALESY, 1);
});

test('aggregates by reply strategy', async () => {
    const insights = await getDraftFeedbackInsights({
        db: makeDb([
            feedback({ id: 'f1', reply_strategy: 'suitability_advice' }),
            feedback({ id: 'f2', reply_strategy: 'purchase_request' }),
            feedback({ id: 'f3', reply_strategy: 'purchase_request' }),
        ]),
    });

    assert.equal(insights.by_reply_strategy.suitability_advice, 1);
    assert.equal(insights.by_reply_strategy.purchase_request, 2);
});

test('aggregates by product grounding mode', async () => {
    const insights = await getDraftFeedbackInsights({
        db: makeDb([
            feedback({ id: 'f1', product_grounding_mode: 'product_first' }),
            feedback({ id: 'f2', product_grounding_mode: 'answer_from_product' }),
            feedback({ id: 'f3', product_grounding_mode: 'answer_from_product' }),
        ]),
    });

    assert.equal(insights.by_product_grounding_mode.product_first, 1);
    assert.equal(insights.by_product_grounding_mode.answer_from_product, 2);
});

test('calculates acceptance edit and rejection rates', async () => {
    const insights = await getDraftFeedbackInsights({
        db: makeDb([
            feedback({ id: 'f1', feedback_type: 'ACCEPTED_AS_IS' }),
            feedback({ id: 'f2', feedback_type: 'EDITED_BEFORE_SEND' }),
            feedback({ id: 'f3', feedback_type: 'REJECTED' }),
            feedback({ id: 'f4', feedback_type: 'NEEDS_REWRITE' }),
        ]),
    });

    assert.equal(insights.accepted_as_is_count, 1);
    assert.equal(insights.edited_count, 1);
    assert.equal(insights.rejected_count, 1);
    assert.equal(insights.needs_rewrite_count, 1);
    assert.equal(insights.acceptance_rate, 0.25);
    assert.equal(insights.edit_rate, 0.25);
    assert.equal(insights.rejection_rate, 0.25);
});

test('separates follow-up feedback from first-draft feedback using reply_watch_id', async () => {
    const insights = await getDraftFeedbackInsights({
        db: makeDb([
            feedback({ id: 'f1', feedback_type: 'REJECTED' }),
            feedback({
                id: 'f2',
                feedback_type: 'REJECTED',
                reply_watch_id: 'watch-1',
            }),
            feedback({
                id: 'f3',
                feedback_type: 'ACCEPTED_AS_IS',
                reply_watch_id: 'watch-2',
            }),
        ]),
    });

    assert.equal(insights.first_draft_feedback_count, 1);
    assert.equal(insights.follow_up_feedback_count, 2);
    assert.equal(insights.follow_up_rejected_count, 1);
    assert.equal(insights.follow_up_rejection_rate, 0.5);
});

test('detects QC-passed-but-rejected mismatch from qc_status', async () => {
    const insights = await getDraftFeedbackInsights({
        db: makeDb([
            feedback({
                id: 'f1',
                feedback_type: 'REJECTED',
                qc_status: { passed: true },
                selected_reasons: ['TOO_AI'],
            }),
            feedback({
                id: 'f2',
                feedback_type: 'EDITED_BEFORE_SEND',
                qc_status: { passed: true },
                selected_reasons: ['TOO_SALESY'],
            }),
        ]),
    });

    assert.equal(insights.qc_passed_but_rejected_count, 1);
    assert.equal(insights.qc_passed_but_edited_count, 1);
    assert.equal(insights.qc_passed_with_too_ai_reason_count, 1);
    assert.equal(insights.qc_passed_with_too_salesy_reason_count, 1);
    assert.equal(insights.qc_mismatch_examples.length, 2);
});

test('produces TOO_AI recommendation', () => {
    const recommendations = buildFeedbackRecommendations({
        total_feedback: 3,
        by_selected_reason: { TOO_AI: 3 },
    });

    assert.equal(recommendations[0].type, 'PROMPT_REVIEW');
});

test('produces TOO_SALESY and CTA recommendation', () => {
    const recommendations = buildFeedbackRecommendations({
        total_feedback: 4,
        by_selected_reason: {
            TOO_SALESY: 2,
            CTA_SHOULD_NOT_BE_INCLUDED: 1,
        },
    });

    assert.equal(recommendations[0].type, 'CTA_STRATEGY_REVIEW');
});

test('produces WRONG_INTENT recommendation', () => {
    const recommendations = buildFeedbackRecommendations({
        total_feedback: 3,
        by_selected_reason: { WRONG_INTENT: 3 },
    });

    assert.equal(recommendations[0].type, 'INTENT_REVIEW');
});

test('filters by brand id', async () => {
    const insights = await getDraftFeedbackInsights({
        db: makeDb([
            feedback({ id: 'f1', brand_id: 'brand-1' }),
            feedback({ id: 'f2', brand_id: 'brand-2' }),
        ]),
        brandId: 'brand-2',
    });

    assert.equal(insights.total_feedback, 1);
    assert.equal(insights.by_feedback_type.ACCEPTED_AS_IS, 1);
});

test('filters by platform', async () => {
    const insights = await getDraftFeedbackInsights({
        db: makeDb([
            feedback({ id: 'f1', platform: 'xiaohongshu' }),
            feedback({ id: 'f2', platform: 'instagram' }),
        ]),
        platform: 'instagram',
    });

    assert.equal(insights.total_feedback, 1);
    assert.equal(insights.by_platform.instagram, 1);
});

test('filters by date range', async () => {
    const insights = await getDraftFeedbackInsights({
        db: makeDb([
            feedback({
                id: 'f1',
                created_at: new Date('2026-05-21T00:00:00.000Z'),
            }),
            feedback({
                id: 'f2',
                created_at: new Date('2026-05-22T12:00:00.000Z'),
            }),
            feedback({
                id: 'f3',
                created_at: new Date('2026-05-23T00:00:00.000Z'),
            }),
        ]),
        from: '2026-05-22T00:00:00.000Z',
        to: '2026-05-22T23:59:59.000Z',
    });

    assert.equal(insights.total_feedback, 1);
});

test('truncates example text', async () => {
    const longText = 'x'.repeat(700);
    const insights = await getDraftFeedbackInsights({
        db: makeDb([
            feedback({
                id: 'f1',
                feedback_type: 'REJECTED',
                original_draft_text: longText,
                human_edited_text: longText,
                final_sent_text: longText,
            }),
        ]),
    });

    const example = insights.rejected_examples[0];
    assert.equal(example.original_draft_text.length, 500);
    assert.equal(example.human_edited_text.length, 500);
    assert.equal(example.final_sent_text.length, 500);
});
