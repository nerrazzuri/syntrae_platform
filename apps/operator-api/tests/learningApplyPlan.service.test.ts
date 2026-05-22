import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.AI_CORE_INTERNAL_SECRET = process.env.AI_CORE_INTERNAL_SECRET || 'test-internal-secret';

import { createApp } from '../src/index';
import { prisma } from '../src/db';
import {
    generateLearningApplyPlan,
    listLearningApplyPlans,
    updateLearningApplyPlanStatus,
} from '../src/services/learningApplyPlan.service';

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

    async findFirst({ where }: any = {}) {
        return this.rows.find((row) => matchesWhere(row, where)) || null;
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

function suggestion(overrides: Record<string, any> = {}) {
    return {
        id: 'suggestion-1',
        account_id: 'account-1',
        brand_id: 'brand-1',
        platform: 'xiaohongshu',
        suggestion_type: 'PROMPT_STYLE_REVIEW',
        status: 'ACCEPTED',
        severity: 'HIGH',
        title: 'Review style',
        message: 'Review style guidance',
        evidence: { selected_reason: 'TOO_AI', count: 3 },
        proposed_action: { actions: ['review platform style profile'] },
        source_insight: { total_feedback: 3 },
        source_feedback_ids: ['feedback-1'],
        metadata: { evidence_signature: 'sig-1' },
        ...overrides,
    };
}

function plan(overrides: Record<string, any> = {}) {
    return {
        id: 'plan-1',
        account_id: 'account-1',
        brand_id: 'brand-1',
        platform: 'xiaohongshu',
        learning_suggestion_id: 'suggestion-1',
        status: 'DRAFT',
        target_area: 'ai_core_prompt_style',
        proposed_change_type: 'prompt_guidance_review',
        risk_level: 'medium',
        summary: 'Review platform style guidance',
        rationale: 'Review only',
        requires_human_approval: true,
        ...overrides,
    };
}

function makeDb(
    suggestionRows: any[] = [suggestion()],
    planRows: any[] = [],
) {
    return {
        learningSuggestion: new FakeModel('suggestion', suggestionRows),
        learningApplyPlan: new FakeModel('plan', planRows),
    };
}

async function generateForType(suggestionType: string) {
    return generateLearningApplyPlan({
        db: makeDb([suggestion({ suggestion_type: suggestionType })]),
        accountId: 'account-1',
        learningSuggestionId: 'suggestion-1',
    });
}

test('requires accountId', async () => {
    await assert.rejects(
        () =>
            generateLearningApplyPlan({
                db: makeDb(),
                accountId: '',
                learningSuggestionId: 'suggestion-1',
            }),
        /accountId is required/,
    );
});

test('requires ACCEPTED suggestion', async () => {
    const db = makeDb([suggestion({ status: 'OPEN' })]);

    await assert.rejects(
        () =>
            generateLearningApplyPlan({
                db,
                accountId: 'account-1',
                learningSuggestionId: 'suggestion-1',
            }),
        /must be ACCEPTED/,
    );
});

test('rejects OPEN suggestion', async () => {
    const db = makeDb([suggestion({ status: 'OPEN' })]);

    await assert.rejects(
        () =>
            generateLearningApplyPlan({
                db,
                accountId: 'account-1',
                learningSuggestionId: 'suggestion-1',
            }),
        /got OPEN/,
    );
});

test('enforces account scope', async () => {
    const db = makeDb([suggestion({ account_id: 'account-2' })]);

    await assert.rejects(
        () =>
            generateLearningApplyPlan({
                db,
                accountId: 'account-1',
                learningSuggestionId: 'suggestion-1',
            }),
        /scope mismatch/,
    );
});

test('generates plan for PROMPT_STYLE_REVIEW', async () => {
    const result = await generateForType('PROMPT_STYLE_REVIEW');
    assert.equal(result.plan.target_area, 'ai_core_prompt_style');
    assert.equal(result.plan.proposed_change_type, 'prompt_guidance_review');
    assert.equal(result.plan.risk_level, 'medium');
    assert.match(result.plan.blocked_auto_apply_reason, /Prompt behavior/);
});

test('generates plan for CTA_GATING_REVIEW', async () => {
    const result = await generateForType('CTA_GATING_REVIEW');
    assert.equal(result.plan.target_area, 'reply_strategy_adapter');
    assert.equal(result.plan.proposed_change_type, 'cta_gating_rule_review');
    assert.equal(result.plan.risk_level, 'high');
});

test('generates plan for INTENT_MAPPING_REVIEW', async () => {
    const result = await generateForType('INTENT_MAPPING_REVIEW');
    assert.equal(result.plan.target_area, 'intent_mapping');
    assert.equal(result.plan.proposed_change_type, 'fallback_bucket_review');
});

test('generates plan for PRODUCT_GROUNDING_REVIEW', async () => {
    const result = await generateForType('PRODUCT_GROUNDING_REVIEW');
    assert.equal(result.plan.target_area, 'product_grounding');
    assert.equal(result.plan.proposed_change_type, 'catalog_grounding_review');
});

test('generates plan for DRAFT_QC_RULE_REVIEW', async () => {
    const result = await generateForType('DRAFT_QC_RULE_REVIEW');
    assert.equal(result.plan.target_area, 'draft_qc');
    assert.equal(result.plan.proposed_change_type, 'qc_rule_candidate');
});

test('generates plan for FOLLOW_UP_PROMPT_REVIEW', async () => {
    const result = await generateForType('FOLLOW_UP_PROMPT_REVIEW');
    assert.equal(result.plan.target_area, 'follow_up_prompt');
    assert.equal(result.plan.proposed_change_type, 'follow_up_context_review');
});

test('generates plan for BRAND_PROFILE_REVIEW', async () => {
    const result = await generateForType('BRAND_PROFILE_REVIEW');
    assert.equal(result.plan.target_area, 'brand_reply_profile');
    assert.equal(result.plan.proposed_change_type, 'brand_profile_hint_review');
});

test('reuses existing DRAFT plan when force is false', async () => {
    const db = makeDb([suggestion()], [plan({ id: 'existing-plan' })]);

    const result = await generateLearningApplyPlan({
        db,
        accountId: 'account-1',
        learningSuggestionId: 'suggestion-1',
    });

    assert.equal(result.generated, false);
    assert.equal(result.plan.id, 'existing-plan');
    assert.equal(db.learningApplyPlan.rows.length, 1);
});

test('creates new plan when force is true', async () => {
    const db = makeDb([suggestion()], [plan({ id: 'existing-plan' })]);

    const result = await generateLearningApplyPlan({
        db,
        accountId: 'account-1',
        learningSuggestionId: 'suggestion-1',
        force: true,
    });

    assert.equal(result.generated, true);
    assert.equal(db.learningApplyPlan.rows.length, 2);
});

test('lists plans by account', async () => {
    const db = makeDb([], [
        plan({ id: 'plan-1', account_id: 'account-1' }),
        plan({ id: 'plan-2', account_id: 'account-2' }),
    ]);

    const rows = await listLearningApplyPlans({ db, accountId: 'account-1' });

    assert.deepEqual(rows.map((row: any) => row.id), ['plan-1']);
});

test('filters plans by status and targetArea', async () => {
    const db = makeDb([], [
        plan({ id: 'plan-1', status: 'DRAFT', target_area: 'draft_qc' }),
        plan({ id: 'plan-2', status: 'REVIEWED', target_area: 'draft_qc' }),
        plan({ id: 'plan-3', status: 'DRAFT', target_area: 'intent_mapping' }),
    ]);

    const rows = await listLearningApplyPlans({
        db,
        accountId: 'account-1',
        status: 'DRAFT',
        targetArea: 'draft_qc',
    });

    assert.deepEqual(rows.map((row: any) => row.id), ['plan-1']);
});

test('updates DRAFT to REVIEWED', async () => {
    const db = makeDb([], [plan()]);

    const row = await updateLearningApplyPlanStatus({
        db,
        accountId: 'account-1',
        planId: 'plan-1',
        status: 'REVIEWED',
        reviewedBy: 'user-1',
        reviewNote: 'Reviewed',
    });

    assert.equal(row.status, 'REVIEWED');
    assert.equal(row.reviewed_by, 'user-1');
});

test('updates DRAFT to CANCELLED', async () => {
    const db = makeDb([], [plan()]);

    const row = await updateLearningApplyPlanStatus({
        db,
        accountId: 'account-1',
        planId: 'plan-1',
        status: 'CANCELLED',
    });

    assert.equal(row.status, 'CANCELLED');
});

test('rejects REVIEWED to CANCELLED', async () => {
    const db = makeDb([], [plan({ status: 'REVIEWED' })]);

    await assert.rejects(
        () =>
            updateLearningApplyPlanStatus({
                db,
                accountId: 'account-1',
                planId: 'plan-1',
                status: 'CANCELLED',
            }),
        /Invalid learning apply plan status transition/,
    );
});

test('internal route generates apply plan', async (t) => {
    const restores: RestoreFn[] = [];
    t.after(() => restores.reverse().forEach((restore) => restore()));
    restores.push(stubMethod(prisma as any, 'learningSuggestion', {
        findUnique: async () => suggestion(),
    } as any));
    restores.push(stubMethod(prisma as any, 'learningApplyPlan', {
        findFirst: async () => null,
        create: async ({ data }: any) => ({ id: 'plan-route', ...data }),
    } as any));

    const app = createApp();
    const res = await request(app)
        .post('/internal/learning-suggestions/suggestion-1/apply-plan')
        .set('x-internal-secret', process.env.AI_CORE_INTERNAL_SECRET!)
        .send({ account_id: 'account-1' });

    assert.equal(res.status, 201);
    assert.equal(res.body.generated, true);
    assert.equal(res.body.plan.id, 'plan-route');
});

test('internal route updates apply plan status', async (t) => {
    const restores: RestoreFn[] = [];
    t.after(() => restores.reverse().forEach((restore) => restore()));
    const existing = plan();
    restores.push(stubMethod(prisma as any, 'learningApplyPlan', {
        findUnique: async () => existing,
        update: async ({ data }: any) => ({ ...existing, ...data }),
    } as any));

    const app = createApp();
    const res = await request(app)
        .post('/internal/learning-apply-plans/plan-1/status')
        .set('x-internal-secret', process.env.AI_CORE_INTERNAL_SECRET!)
        .send({ account_id: 'account-1', status: 'REVIEWED', reviewed_by: 'user-1' });

    assert.equal(res.status, 200);
    assert.equal(res.body.plan.status, 'REVIEWED');
    assert.equal(res.body.plan.reviewed_by, 'user-1');
});

test('does not mark LearningSuggestion as APPLIED', async () => {
    const db = makeDb([suggestion()], []);

    await generateLearningApplyPlan({
        db,
        accountId: 'account-1',
        learningSuggestionId: 'suggestion-1',
    });

    assert.equal(db.learningSuggestion.rows[0].status, 'ACCEPTED');
});
