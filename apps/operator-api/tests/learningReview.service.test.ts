import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.AI_CORE_INTERNAL_SECRET = process.env.AI_CORE_INTERNAL_SECRET || 'test-internal-secret';

import { createApp } from '../src/index';
import { prisma } from '../src/db';
import {
    getLearningReviewDashboard,
    getLearningReviewDetail,
} from '../src/services/learningReview.service';

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

function byId(rows: any[], id: string) {
    return rows.find((row) => row.id === id) || null;
}

function matchesWhere(row: any, where: Record<string, any> = {}) {
    for (const [key, value] of Object.entries(where || {})) {
        if (value === undefined || value === '') continue;
        if (row[key] !== value) return false;
    }
    return true;
}

class FakeModel {
    rows: any[];

    constructor(rows: any[] = []) {
        this.rows = rows;
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
}

function suggestion(overrides: Record<string, any> = {}) {
    return {
        id: overrides.id || 'suggestion-1',
        account_id: 'account-1',
        brand_id: 'brand-1',
        platform: 'xiaohongshu',
        suggestion_type: 'PROMPT_STYLE_REVIEW',
        status: 'OPEN',
        severity: 'MEDIUM',
        source_feedback_ids: ['feedback-1'],
        created_at: new Date('2026-05-22T00:00:00.000Z'),
        ...overrides,
    };
}

function plan(overrides: Record<string, any> = {}) {
    return {
        id: overrides.id || 'plan-1',
        account_id: 'account-1',
        brand_id: 'brand-1',
        platform: 'xiaohongshu',
        learning_suggestion_id: 'suggestion-1',
        status: 'DRAFT',
        risk_level: 'medium',
        created_at: new Date('2026-05-22T00:30:00.000Z'),
        ...overrides,
    };
}

function feedback(overrides: Record<string, any> = {}) {
    return {
        id: overrides.id || 'feedback-1',
        account_id: 'account-1',
        brand_id: 'brand-1',
        platform: 'xiaohongshu',
        outreach_draft_id: 'draft-1',
        feedback_type: 'REJECTED',
        selected_reasons: ['TOO_AI'],
        original_draft_text: 'AI-ish reply',
        human_edited_text: null,
        final_sent_text: null,
        reply_strategy: 'suitability_advice',
        product_grounding_mode: 'diagnostic_then_product_support',
        qc_status: { passed: false },
        created_at: new Date('2026-05-22T00:10:00.000Z'),
        ...overrides,
    };
}

function makeDb({
    suggestions = [],
    plans = [],
    feedbackRows = [],
}: {
    suggestions?: any[];
    plans?: any[];
    feedbackRows?: any[];
} = {}) {
    return {
        learningSuggestion: new FakeModel(suggestions),
        learningApplyPlan: new FakeModel(plans),
        draftFeedback: new FakeModel(feedbackRows),
    };
}

test('requires accountId', async () => {
    await assert.rejects(
        () => getLearningReviewDashboard({ db: makeDb(), accountId: '' }),
        /accountId is required/,
    );
});

test('returns empty dashboard structure when no suggestions', async () => {
    const dashboard = await getLearningReviewDashboard({
        db: makeDb(),
        accountId: 'account-1',
    });

    assert.equal(dashboard.summary.total_suggestions, 0);
    assert.equal(dashboard.feedback_insights.total_feedback, 0);
    assert.deepEqual(dashboard.review_queue, []);
});

test('includes feedback insights', async () => {
    const dashboard = await getLearningReviewDashboard({
        db: makeDb({ feedbackRows: [feedback()] }),
        accountId: 'account-1',
    });

    assert.equal(dashboard.feedback_insights.total_feedback, 1);
    assert.equal(dashboard.feedback_insights.by_selected_reason.TOO_AI, 1);
});

test('lists OPEN suggestion in review queue', async () => {
    const dashboard = await getLearningReviewDashboard({
        db: makeDb({ suggestions: [suggestion()] }),
        accountId: 'account-1',
    });

    assert.equal(dashboard.review_queue.length, 1);
    assert.equal(dashboard.review_queue[0].suggestion.status, 'OPEN');
});

test('OPEN suggestion next_action is ARCHIVE_OR_REJECT', async () => {
    const dashboard = await getLearningReviewDashboard({
        db: makeDb({ suggestions: [suggestion()] }),
        accountId: 'account-1',
    });

    assert.equal(dashboard.review_queue[0].next_action.type, 'ARCHIVE_OR_REJECT');
});

test('ACCEPTED suggestion without plan next_action is GENERATE_APPLY_PLAN', async () => {
    const dashboard = await getLearningReviewDashboard({
        db: makeDb({ suggestions: [suggestion({ status: 'ACCEPTED' })] }),
        accountId: 'account-1',
    });

    assert.equal(dashboard.review_queue[0].next_action.type, 'GENERATE_APPLY_PLAN');
});

test('ACCEPTED suggestion with DRAFT plan next_action is REVIEW_APPLY_PLAN', async () => {
    const dashboard = await getLearningReviewDashboard({
        db: makeDb({
            suggestions: [suggestion({ status: 'ACCEPTED' })],
            plans: [plan()],
        }),
        accountId: 'account-1',
    });

    assert.equal(dashboard.review_queue[0].next_action.type, 'REVIEW_APPLY_PLAN');
});

test('REJECTED suggestion next_action is NO_ACTION', async () => {
    const dashboard = await getLearningReviewDashboard({
        db: makeDb({ suggestions: [suggestion({ status: 'REJECTED' })] }),
        accountId: 'account-1',
    });

    assert.equal(dashboard.review_queue[0].next_action.type, 'NO_ACTION');
});

test('REVIEWED apply plan next_action is NO_ACTION', async () => {
    const dashboard = await getLearningReviewDashboard({
        db: makeDb({
            suggestions: [suggestion({ status: 'ACCEPTED' })],
            plans: [plan({ status: 'REVIEWED' })],
        }),
        accountId: 'account-1',
    });

    assert.equal(dashboard.review_queue[0].next_action.type, 'NO_ACTION');
});

test('loads source feedback examples from source_feedback_ids', async () => {
    const dashboard = await getLearningReviewDashboard({
        db: makeDb({
            suggestions: [suggestion({ source_feedback_ids: ['feedback-1'] })],
            feedbackRows: [feedback()],
        }),
        accountId: 'account-1',
    });

    assert.equal(dashboard.review_queue[0].source_feedback_examples.length, 1);
    assert.equal(dashboard.review_queue[0].source_feedback_examples[0].id, 'feedback-1');
});

test('truncates feedback example text', async () => {
    const longText = 'x'.repeat(700);
    const dashboard = await getLearningReviewDashboard({
        db: makeDb({
            suggestions: [suggestion()],
            feedbackRows: [
                feedback({
                    original_draft_text: longText,
                    human_edited_text: longText,
                    final_sent_text: longText,
                }),
            ],
        }),
        accountId: 'account-1',
    });

    const example = dashboard.review_queue[0].source_feedback_examples[0];
    assert.equal(example.original_draft_text.length, 500);
    assert.equal(example.human_edited_text.length, 500);
    assert.equal(example.final_sent_text.length, 500);
});

test('summary counts suggestion statuses', async () => {
    const dashboard = await getLearningReviewDashboard({
        db: makeDb({
            suggestions: [
                suggestion({ id: 's1', status: 'OPEN' }),
                suggestion({ id: 's2', status: 'ACCEPTED' }),
                suggestion({ id: 's3', status: 'REJECTED' }),
                suggestion({ id: 's4', status: 'ARCHIVED' }),
            ],
        }),
        accountId: 'account-1',
    });

    assert.equal(dashboard.summary.open_suggestions, 1);
    assert.equal(dashboard.summary.accepted_suggestions, 1);
    assert.equal(dashboard.summary.rejected_suggestions, 1);
    assert.equal(dashboard.summary.archived_suggestions, 1);
});

test('summary counts apply plan statuses', async () => {
    const dashboard = await getLearningReviewDashboard({
        db: makeDb({
            suggestions: [
                suggestion({ id: 's1', status: 'ACCEPTED' }),
                suggestion({ id: 's2', status: 'ACCEPTED' }),
                suggestion({ id: 's3', status: 'ACCEPTED' }),
            ],
            plans: [
                plan({ id: 'p1', learning_suggestion_id: 's1', status: 'DRAFT' }),
                plan({ id: 'p2', learning_suggestion_id: 's2', status: 'REVIEWED' }),
                plan({ id: 'p3', learning_suggestion_id: 's3', status: 'CANCELLED' }),
            ],
        }),
        accountId: 'account-1',
    });

    assert.equal(dashboard.summary.draft_apply_plans, 1);
    assert.equal(dashboard.summary.reviewed_apply_plans, 1);
    assert.equal(dashboard.summary.cancelled_apply_plans, 1);
});

test('summary counts risk levels', async () => {
    const dashboard = await getLearningReviewDashboard({
        db: makeDb({
            suggestions: [
                suggestion({ id: 's1', severity: 'HIGH' }),
                suggestion({ id: 's2', severity: 'MEDIUM' }),
                suggestion({ id: 's3', severity: 'LOW' }),
            ],
        }),
        accountId: 'account-1',
    });

    assert.equal(dashboard.summary.high_risk_items, 1);
    assert.equal(dashboard.summary.medium_risk_items, 1);
    assert.equal(dashboard.summary.low_risk_items, 1);
});

test('filters by brand_id', async () => {
    const dashboard = await getLearningReviewDashboard({
        db: makeDb({
            suggestions: [
                suggestion({ id: 's1', brand_id: 'brand-1' }),
                suggestion({ id: 's2', brand_id: 'brand-2' }),
            ],
        }),
        accountId: 'account-1',
        brandId: 'brand-2',
    });

    assert.equal(dashboard.review_queue.length, 1);
    assert.equal(dashboard.review_queue[0].suggestion.id, 's2');
});

test('filters by platform', async () => {
    const dashboard = await getLearningReviewDashboard({
        db: makeDb({
            suggestions: [
                suggestion({ id: 's1', platform: 'xiaohongshu' }),
                suggestion({ id: 's2', platform: 'instagram' }),
            ],
        }),
        accountId: 'account-1',
        platform: 'instagram',
    });

    assert.equal(dashboard.review_queue.length, 1);
    assert.equal(dashboard.review_queue[0].suggestion.id, 's2');
});

test('filters by suggestion status', async () => {
    const dashboard = await getLearningReviewDashboard({
        db: makeDb({
            suggestions: [
                suggestion({ id: 's1', status: 'OPEN' }),
                suggestion({ id: 's2', status: 'ACCEPTED' }),
            ],
        }),
        accountId: 'account-1',
        suggestionStatus: 'ACCEPTED',
    });

    assert.equal(dashboard.review_queue.length, 1);
    assert.equal(dashboard.review_queue[0].suggestion.id, 's2');
});

test('filters by plan status', async () => {
    const dashboard = await getLearningReviewDashboard({
        db: makeDb({
            suggestions: [suggestion({ id: 's1', status: 'ACCEPTED' })],
            plans: [
                plan({ id: 'p1', learning_suggestion_id: 's1', status: 'DRAFT' }),
                plan({ id: 'p2', learning_suggestion_id: 's1', status: 'REVIEWED' }),
            ],
        }),
        accountId: 'account-1',
        planStatus: 'REVIEWED',
    });

    assert.equal(dashboard.review_queue[0].apply_plan.id, 'p2');
});

test('detail API returns suggestion plans examples and next action', async () => {
    const detail = await getLearningReviewDetail({
        db: makeDb({
            suggestions: [suggestion({ status: 'ACCEPTED' })],
            plans: [plan()],
            feedbackRows: [feedback()],
        }),
        accountId: 'account-1',
        learningSuggestionId: 'suggestion-1',
    });

    assert.equal(detail.suggestion.id, 'suggestion-1');
    assert.equal(detail.apply_plans.length, 1);
    assert.equal(detail.source_feedback_examples.length, 1);
    assert.equal(detail.recommended_next_action.type, 'REVIEW_APPLY_PLAN');
});

test('detail API enforces account scope', async () => {
    await assert.rejects(
        () =>
            getLearningReviewDetail({
                db: makeDb({ suggestions: [suggestion({ account_id: 'account-2' })] }),
                accountId: 'account-1',
                learningSuggestionId: 'suggestion-1',
            }),
        /scope mismatch/,
    );
});

test('internal dashboard route works', async (t) => {
    const restores: RestoreFn[] = [];
    t.after(() => restores.reverse().forEach((restore) => restore()));
    restores.push(stubMethod(prisma as any, 'learningSuggestion', new FakeModel([suggestion()]) as any));
    restores.push(stubMethod(prisma as any, 'learningApplyPlan', new FakeModel([]) as any));
    restores.push(stubMethod(prisma as any, 'draftFeedback', new FakeModel([feedback()]) as any));

    const app = createApp();
    const res = await request(app)
        .get('/internal/learning-review/dashboard?account_id=account-1')
        .set('x-internal-secret', process.env.AI_CORE_INTERNAL_SECRET!);

    assert.equal(res.status, 200);
    assert.equal(res.body.dashboard.review_queue.length, 1);
});

test('internal detail route works', async (t) => {
    const restores: RestoreFn[] = [];
    t.after(() => restores.reverse().forEach((restore) => restore()));
    restores.push(stubMethod(prisma as any, 'learningSuggestion', new FakeModel([suggestion({ status: 'ACCEPTED' })]) as any));
    restores.push(stubMethod(prisma as any, 'learningApplyPlan', new FakeModel([plan()]) as any));
    restores.push(stubMethod(prisma as any, 'draftFeedback', new FakeModel([feedback()]) as any));

    const app = createApp();
    const res = await request(app)
        .get('/internal/learning-review/suggestions/suggestion-1?account_id=account-1')
        .set('x-internal-secret', process.env.AI_CORE_INTERNAL_SECRET!);

    assert.equal(res.status, 200);
    assert.equal(res.body.detail.suggestion.id, 'suggestion-1');
    assert.equal(res.body.detail.recommended_next_action.type, 'REVIEW_APPLY_PLAN');
});
