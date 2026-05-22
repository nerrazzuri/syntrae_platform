import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.AI_CORE_INTERNAL_SECRET = process.env.AI_CORE_INTERNAL_SECRET || 'test-internal-secret';

import { createApp } from '../src/index';
import { prisma } from '../src/db';
import {
    generateApplyCandidatesFromPlan,
    listApplyCandidates,
    updateApplyCandidateStatus,
} from '../src/services/applyCandidate.service';

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
        severity: 'MEDIUM',
        source_feedback_ids: ['feedback-1'],
        metadata: { evidence_signature: 'suggestion-sig' },
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
        status: 'REVIEWED',
        target_area: 'ai_core_prompt_style',
        proposed_change_type: 'prompt_guidance_review',
        risk_level: 'medium',
        summary: 'Review style',
        ...overrides,
    };
}

function candidate(overrides: Record<string, any> = {}) {
    return {
        id: 'candidate-1',
        account_id: 'account-1',
        brand_id: 'brand-1',
        platform: 'xiaohongshu',
        learning_suggestion_id: 'suggestion-1',
        learning_apply_plan_id: 'plan-1',
        candidate_type: 'STYLE_GUIDANCE',
        status: 'PENDING',
        title: 'Review style',
        description: 'Review style',
        candidate_payload: { target: 'platform_style_profile' },
        source_feedback_ids: ['feedback-1'],
        risk_level: 'medium',
        metadata: { evidence_signature: 'candidate-sig' },
        created_at: new Date('2026-05-22T00:00:00.000Z'),
        ...overrides,
    };
}

function feedback(overrides: Record<string, any> = {}) {
    return {
        id: 'feedback-1',
        account_id: 'account-1',
        original_draft_text: '普通回复',
        human_edited_text: null,
        final_sent_text: null,
        feedback_note: null,
        created_at: new Date('2026-05-22T00:00:00.000Z'),
        ...overrides,
    };
}

function makeDb({
    plans = [plan()],
    suggestions = [suggestion()],
    candidates = [],
    feedbackRows = [feedback()],
}: {
    plans?: any[];
    suggestions?: any[];
    candidates?: any[];
    feedbackRows?: any[];
} = {}) {
    return {
        learningApplyPlan: new FakeModel('plan', plans),
        learningSuggestion: new FakeModel('suggestion', suggestions),
        applyCandidate: new FakeModel('candidate', candidates),
        draftFeedback: new FakeModel('feedback', feedbackRows),
    };
}

async function generateForTarget(targetArea: string) {
    return generateApplyCandidatesFromPlan({
        db: makeDb({
            plans: [plan({ target_area: targetArea })],
        }),
        accountId: 'account-1',
        learningApplyPlanId: 'plan-1',
    });
}

test('requires accountId', async () => {
    await assert.rejects(
        () =>
            generateApplyCandidatesFromPlan({
                db: makeDb(),
                accountId: '',
                learningApplyPlanId: 'plan-1',
            }),
        /accountId is required/,
    );
});

test('requires REVIEWED apply plan', async () => {
    const result = await generateApplyCandidatesFromPlan({
        db: makeDb({ plans: [plan({ status: 'REVIEWED' })] }),
        accountId: 'account-1',
        learningApplyPlanId: 'plan-1',
    });

    assert.equal(result.persisted_count, 1);
});

test('rejects DRAFT apply plan', async () => {
    await assert.rejects(
        () =>
            generateApplyCandidatesFromPlan({
                db: makeDb({ plans: [plan({ status: 'DRAFT' })] }),
                accountId: 'account-1',
                learningApplyPlanId: 'plan-1',
            }),
        /must be REVIEWED/,
    );
});

test('enforces account scope', async () => {
    await assert.rejects(
        () =>
            generateApplyCandidatesFromPlan({
                db: makeDb({ plans: [plan({ account_id: 'account-2' })] }),
                accountId: 'account-1',
                learningApplyPlanId: 'plan-1',
            }),
        /scope mismatch/,
    );
});

test('generates STYLE_GUIDANCE candidate for ai_core_prompt_style', async () => {
    const result = await generateForTarget('ai_core_prompt_style');
    assert.equal(result.candidates[0].candidate_type, 'STYLE_GUIDANCE');
    assert.equal(result.candidates[0].candidate_payload.target, 'platform_style_profile');
});

test('generates DRAFT_QC_TEST_CASE candidate for reply_strategy_adapter', async () => {
    const result = await generateForTarget('reply_strategy_adapter');
    assert.equal(result.candidates[0].candidate_type, 'DRAFT_QC_TEST_CASE');
    assert.equal(result.candidates[0].candidate_payload.target, 'cta_gating');
});

test('generates INTENT_MAPPING_TEST_CASE candidate for intent_mapping', async () => {
    const result = await generateForTarget('intent_mapping');
    assert.equal(result.candidates[0].candidate_type, 'INTENT_MAPPING_TEST_CASE');
});

test('generates PRODUCT_GROUNDING_REVIEW candidate for product_grounding', async () => {
    const result = await generateForTarget('product_grounding');
    assert.equal(result.candidates[0].candidate_type, 'PRODUCT_GROUNDING_REVIEW');
});

test('generates DRAFT_QC_TEST_CASE candidate for draft_qc', async () => {
    const result = await generateForTarget('draft_qc');
    assert.equal(result.candidates[0].candidate_type, 'DRAFT_QC_TEST_CASE');
    assert.equal(result.candidates[0].candidate_payload.target, 'draft_qc');
});

test('generates FOLLOW_UP_PROMPT_TEST_CASE candidate for follow_up_prompt', async () => {
    const result = await generateForTarget('follow_up_prompt');
    assert.equal(result.candidates[0].candidate_type, 'FOLLOW_UP_PROMPT_TEST_CASE');
});

test('generates BRAND_PROFILE_HINT candidate for brand_reply_profile', async () => {
    const result = await generateForTarget('brand_reply_profile');
    assert.equal(result.candidates[0].candidate_type, 'BRAND_PROFILE_HINT');
});

test('generates OTHER candidate for unknown targetArea', async () => {
    const result = await generateForTarget('unknown_target');
    assert.equal(result.candidates[0].candidate_type, 'OTHER');
});

test('skips duplicate PENDING candidate when force is false', async () => {
    const db = makeDb();
    await generateApplyCandidatesFromPlan({
        db,
        accountId: 'account-1',
        learningApplyPlanId: 'plan-1',
    });
    const result = await generateApplyCandidatesFromPlan({
        db,
        accountId: 'account-1',
        learningApplyPlanId: 'plan-1',
    });

    assert.equal(result.persisted_count, 0);
    assert.equal(result.skipped_duplicate_count, 1);
    assert.equal(db.applyCandidate.rows.length, 1);
});

test('persists new duplicate when force is true', async () => {
    const db = makeDb();
    await generateApplyCandidatesFromPlan({
        db,
        accountId: 'account-1',
        learningApplyPlanId: 'plan-1',
    });
    const result = await generateApplyCandidatesFromPlan({
        db,
        accountId: 'account-1',
        learningApplyPlanId: 'plan-1',
        force: true,
    });

    assert.equal(result.persisted_count, 1);
    assert.equal(db.applyCandidate.rows.length, 2);
});

test('lists candidates by account', async () => {
    const db = makeDb({
        plans: [],
        suggestions: [],
        candidates: [
            candidate({ id: 'candidate-1', account_id: 'account-1' }),
            candidate({ id: 'candidate-2', account_id: 'account-2' }),
        ],
    });

    const rows = await listApplyCandidates({ db, accountId: 'account-1' });

    assert.deepEqual(rows.map((row: any) => row.id), ['candidate-1']);
});

test('filters candidates by brand platform status and type', async () => {
    const db = makeDb({
        plans: [],
        suggestions: [],
        candidates: [
            candidate({ id: 'candidate-1', brand_id: 'brand-1', platform: 'xhs', status: 'PENDING', candidate_type: 'STYLE_GUIDANCE' }),
            candidate({ id: 'candidate-2', brand_id: 'brand-2', platform: 'xhs', status: 'PENDING', candidate_type: 'STYLE_GUIDANCE' }),
            candidate({ id: 'candidate-3', brand_id: 'brand-1', platform: 'ig', status: 'PENDING', candidate_type: 'STYLE_GUIDANCE' }),
            candidate({ id: 'candidate-4', brand_id: 'brand-1', platform: 'xhs', status: 'ACCEPTED', candidate_type: 'STYLE_GUIDANCE' }),
            candidate({ id: 'candidate-5', brand_id: 'brand-1', platform: 'xhs', status: 'PENDING', candidate_type: 'OTHER' }),
        ],
    });

    const rows = await listApplyCandidates({
        db,
        accountId: 'account-1',
        brandId: 'brand-1',
        platform: 'xhs',
        status: 'PENDING',
        candidateType: 'STYLE_GUIDANCE',
    });

    assert.deepEqual(rows.map((row: any) => row.id), ['candidate-1']);
});

test('updates PENDING to ACCEPTED', async () => {
    const db = makeDb({ plans: [], suggestions: [], candidates: [candidate()] });

    const row = await updateApplyCandidateStatus({
        db,
        accountId: 'account-1',
        candidateId: 'candidate-1',
        status: 'ACCEPTED',
        reviewedBy: 'user-1',
    });

    assert.equal(row.status, 'ACCEPTED');
    assert.equal(row.reviewed_by, 'user-1');
});

test('updates PENDING to REJECTED', async () => {
    const db = makeDb({ plans: [], suggestions: [], candidates: [candidate()] });

    const row = await updateApplyCandidateStatus({
        db,
        accountId: 'account-1',
        candidateId: 'candidate-1',
        status: 'REJECTED',
    });

    assert.equal(row.status, 'REJECTED');
});

test('rejects REJECTED to ACCEPTED', async () => {
    const db = makeDb({
        plans: [],
        suggestions: [],
        candidates: [candidate({ status: 'REJECTED' })],
    });

    await assert.rejects(
        () =>
            updateApplyCandidateStatus({
                db,
                accountId: 'account-1',
                candidateId: 'candidate-1',
                status: 'ACCEPTED',
            }),
        /Invalid apply candidate status transition/,
    );
});

test('rejects setting IMPLEMENTED', async () => {
    const db = makeDb({ plans: [], suggestions: [], candidates: [candidate()] });

    await assert.rejects(
        () =>
            updateApplyCandidateStatus({
                db,
                accountId: 'account-1',
                candidateId: 'candidate-1',
                status: 'IMPLEMENTED' as any,
            }),
        /Invalid apply candidate review status/,
    );
});

test('internal route generates candidates', async (t) => {
    const restores: RestoreFn[] = [];
    t.after(() => restores.reverse().forEach((restore) => restore()));
    restores.push(stubMethod(prisma as any, 'learningApplyPlan', {
        findUnique: async () => plan(),
    } as any));
    restores.push(stubMethod(prisma as any, 'learningSuggestion', {
        findUnique: async () => suggestion(),
    } as any));
    restores.push(stubMethod(prisma as any, 'applyCandidate', {
        findMany: async () => [],
        create: async ({ data }: any) => ({ id: 'candidate-route', ...data }),
    } as any));
    restores.push(stubMethod(prisma as any, 'draftFeedback', {
        findMany: async () => [],
    } as any));

    const app = createApp();
    const res = await request(app)
        .post('/internal/learning-apply-plans/plan-1/candidates')
        .set('x-internal-secret', process.env.AI_CORE_INTERNAL_SECRET!)
        .send({ account_id: 'account-1' });

    assert.equal(res.status, 200);
    assert.equal(res.body.persisted_count, 1);
    assert.equal(res.body.candidates[0].id, 'candidate-route');
});

test('internal route status update works', async (t) => {
    const restores: RestoreFn[] = [];
    t.after(() => restores.reverse().forEach((restore) => restore()));
    const existing = candidate();
    restores.push(stubMethod(prisma as any, 'applyCandidate', {
        findUnique: async () => existing,
        update: async ({ data }: any) => ({ ...existing, ...data }),
    } as any));

    const app = createApp();
    const res = await request(app)
        .post('/internal/apply-candidates/candidate-1/status')
        .set('x-internal-secret', process.env.AI_CORE_INTERNAL_SECRET!)
        .send({ account_id: 'account-1', status: 'ACCEPTED', reviewed_by: 'user-1' });

    assert.equal(res.status, 200);
    assert.equal(res.body.candidate.status, 'ACCEPTED');
    assert.equal(res.body.candidate.reviewed_by, 'user-1');
});

test('does not mark LearningSuggestion as APPLIED', async () => {
    const db = makeDb();

    await generateApplyCandidatesFromPlan({
        db,
        accountId: 'account-1',
        learningApplyPlanId: 'plan-1',
    });

    assert.equal(db.learningSuggestion.rows[0].status, 'ACCEPTED');
});

test('does not modify LearningApplyPlan status', async () => {
    const db = makeDb();

    await generateApplyCandidatesFromPlan({
        db,
        accountId: 'account-1',
        learningApplyPlanId: 'plan-1',
    });

    assert.equal(db.learningApplyPlan.rows[0].status, 'REVIEWED');
});
