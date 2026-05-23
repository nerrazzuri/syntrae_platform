import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../src/index';
import { prisma } from '../src/db';
import { SessionStore } from '../src/services/auth/session_store';

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

function activeSession(workspaceId = 'account-1') {
    return {
        id: 'session-1',
        user_id: 'user-1',
        active_workspace_id: workspaceId,
        expires_at: new Date(Date.now() + 60_000),
        last_seen_at: new Date(),
        created_at: new Date(),
        user: {
            id: 'user-1',
            email: 'owner@test.local',
        },
        active_workspace: {
            id: workspaceId,
            status: 'ACTIVE',
        },
    } as any;
}

function byId(rows: any[], id: string) {
    return rows.find((row) => row.id === id) || null;
}

function matchesWhere(row: any, where: Record<string, any> = {}) {
    for (const [key, value] of Object.entries(where || {})) {
        if (value === undefined) continue;
        if (row[key] !== value) return false;
    }
    return true;
}

class FakeModel {
    rows: any[];
    prefix: string;
    nextId = 1;

    constructor(prefix: string, rows: any[] = []) {
        this.prefix = prefix;
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

    async create({ data }: any) {
        const now = new Date('2026-05-23T00:00:00.000Z');
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
            updated_at: new Date('2026-05-23T01:00:00.000Z'),
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

function setupRouteTest(t: any, draftOverrides: Record<string, any> = {}, workspaceId = 'account-1') {
    const draftModel = new FakeModel('draft', [makeDraft(draftOverrides)]);
    const feedbackModel = new FakeModel('feedback', []);
    const restores: RestoreFn[] = [];

    restores.push(stubMethod(SessionStore, 'getSession', (async () => activeSession(workspaceId)) as any));
    restores.push(stubMethod(prisma as any, 'outreachDraft', draftModel as any));
    restores.push(stubMethod(prisma as any, 'draftFeedback', feedbackModel as any));
    t.after(() => restores.reverse().forEach((restore) => restore()));

    return {
        app: createApp(),
        draftModel,
        feedbackModel,
    };
}

test('session draft feedback endpoint records ACCEPTED_AS_IS', async (t) => {
    const { app, feedbackModel } = setupRouteTest(t);

    const res = await request(app)
        .post('/drafts/draft-1/feedback')
        .set('Cookie', ['syntrae_session=session-1'])
        .send({
            feedback_type: 'ACCEPTED_AS_IS',
            selected_reasons: ['GOOD_REPLY'],
            final_sent_text: '不是你不适合猫眼，主要是这副框偏大。',
            metadata: { decision_action: 'approve_as_is' },
        });

    assert.equal(res.status, 201);
    assert.equal(res.body.feedback.feedback_type, 'ACCEPTED_AS_IS');
    assert.deepEqual(res.body.feedback.selected_reasons, ['GOOD_REPLY']);
    assert.equal(feedbackModel.rows.length, 1);
});

test('session draft feedback endpoint records EDITED_BEFORE_SEND with human edit', async (t) => {
    const { app } = setupRouteTest(t);

    const res = await request(app)
        .post('/drafts/draft-1/feedback')
        .set('Cookie', ['syntrae_session=session-1'])
        .send({
            feedback_type: 'EDITED_BEFORE_SEND',
            human_edited_text: '换小一圈、线条柔和一点的猫眼会自然很多～',
            final_sent_text: '换小一圈、线条柔和一点的猫眼会自然很多～',
            metadata: { decision_action: 'approve_after_edit' },
        });

    assert.equal(res.status, 201);
    assert.equal(res.body.feedback.feedback_type, 'EDITED_BEFORE_SEND');
    assert.equal(res.body.feedback.human_edited_text, '换小一圈、线条柔和一点的猫眼会自然很多～');
});

test('session draft feedback endpoint records REJECTED with selected reasons', async (t) => {
    const { app } = setupRouteTest(t);

    const res = await request(app)
        .post('/drafts/draft-1/feedback')
        .set('Cookie', ['syntrae_session=session-1'])
        .send({
            feedback_type: 'REJECTED',
            selected_reasons: ['TOO_AI', 'TOO_SALESY'],
            feedback_note: 'Too robotic.',
            metadata: { decision_action: 'reject' },
        });

    assert.equal(res.status, 201);
    assert.equal(res.body.feedback.feedback_type, 'REJECTED');
    assert.deepEqual(res.body.feedback.selected_reasons, ['TOO_AI', 'TOO_SALESY']);
});

test('session draft feedback endpoint enforces workspace account scope', async (t) => {
    const { app } = setupRouteTest(t, {}, 'account-2');

    const res = await request(app)
        .post('/drafts/draft-1/feedback')
        .set('Cookie', ['syntrae_session=session-1'])
        .send({
            feedback_type: 'ACCEPTED_AS_IS',
        });

    assert.equal(res.status, 403);
});

test('session draft feedback endpoint rejects invalid selected reason', async (t) => {
    const { app } = setupRouteTest(t);

    const res = await request(app)
        .post('/drafts/draft-1/feedback')
        .set('Cookie', ['syntrae_session=session-1'])
        .send({
            feedback_type: 'REJECTED',
            selected_reasons: ['BAD_REASON'],
        });

    assert.equal(res.status, 400);
    assert.match(String(res.body.error), /Invalid selectedReasons/);
});

test('session draft feedback endpoint preserves follow-up reply watch metadata', async (t) => {
    const { app } = setupRouteTest(t, {
        generation_meta: {
            reply_strategy: 'purchase_request',
            reply_watch_id: 'watch-1',
            previous_draft_id: 'draft-original',
            strategy_meta: {
                reply_mode: 'answer_then_soft_cta',
                product_grounding_mode: 'product_first',
            },
        },
    });

    const res = await request(app)
        .post('/drafts/draft-1/feedback')
        .set('Cookie', ['syntrae_session=session-1'])
        .send({
            feedback_type: 'EDITED_BEFORE_SEND',
            human_edited_text: '主页有链接～',
            final_sent_text: '主页有链接～',
            metadata: { decision_action: 'send_to_thread' },
        });

    assert.equal(res.status, 201);
    assert.equal(res.body.feedback.reply_watch_id, 'watch-1');
    assert.equal(res.body.feedback.metadata.parent_outreach_draft_id, 'draft-original');
});

test('session draft feedback endpoint stores final sent text', async (t) => {
    const { app } = setupRouteTest(t);

    const res = await request(app)
        .post('/drafts/draft-1/feedback')
        .set('Cookie', ['syntrae_session=session-1'])
        .send({
            feedback_type: 'ACCEPTED_AS_IS',
            final_sent_text: '最终发送文本',
            metadata: { decision_action: 'send_to_thread' },
        });

    assert.equal(res.status, 201);
    assert.equal(res.body.feedback.final_sent_text, '最终发送文本');
});

test('session draft feedback endpoint dedupes same decision action and text', async (t) => {
    const { app, feedbackModel } = setupRouteTest(t);

    const payload = {
        feedback_type: 'ACCEPTED_AS_IS',
        selected_reasons: ['GOOD_REPLY'],
        final_sent_text: '最终发送文本',
        metadata: { decision_action: 'approve_as_is' },
    };
    const first = await request(app)
        .post('/drafts/draft-1/feedback')
        .set('Cookie', ['syntrae_session=session-1'])
        .send(payload);
    const second = await request(app)
        .post('/drafts/draft-1/feedback')
        .set('Cookie', ['syntrae_session=session-1'])
        .send(payload);

    assert.equal(first.status, 201);
    assert.equal(second.status, 200);
    assert.equal(second.body.deduped, true);
    assert.equal(feedbackModel.rows.length, 1);
});
