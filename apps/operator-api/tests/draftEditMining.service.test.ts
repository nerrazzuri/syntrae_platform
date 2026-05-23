import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../src/index';
import { prisma } from '../src/db';
import { SessionStore } from '../src/services/auth/session_store';
import { mineDraftEdits } from '../src/services/draftEditMining.service';

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
}

function feedback(overrides: Record<string, any> = {}) {
    return {
        id: overrides.id || 'feedback-1',
        account_id: 'account-1',
        brand_id: 'brand-1',
        platform: 'xiaohongshu',
        feedback_type: 'EDITED_BEFORE_SEND',
        original_draft_text: '当然可以，欢迎访问我们的店铺，帮你找到最合适的款式。你希望找到更适合你脸型的吗？',
        human_edited_text: '不是你不适合猫眼，主要是这副框偏大。',
        final_sent_text: null,
        generation_meta: {},
        metadata: null,
        created_at: new Date('2026-05-23T00:00:00.000Z'),
        ...overrides,
    };
}

function makeDb(rows: any[] = [], candidates: any[] = []) {
    return {
        draftFeedback: new FakeModel('feedback', rows),
        applyCandidate: new FakeModel('candidate', candidates),
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

test('requires accountId', async () => {
    await assert.rejects(
        () => mineDraftEdits({ db: makeDb(), accountId: '' }),
        /accountId is required/,
    );
});

test('loads only EDITED_BEFORE_SEND feedback', async () => {
    const db = makeDb([
        feedback({ id: 'edited-1' }),
        feedback({ id: 'accepted-1', feedback_type: 'ACCEPTED_AS_IS' }),
    ]);

    const result = await mineDraftEdits({
        db,
        accountId: 'account-1',
        minOccurrences: 1,
        dryRun: true,
    });

    assert.equal(result.insights.total_feedback, 1);
    assert.equal(result.insights.analyzed_feedback, 1);
});

test('detects removed AI phrase', async () => {
    const result = await mineDraftEdits({
        db: makeDb([feedback({ id: 'f1' })]),
        accountId: 'account-1',
        minOccurrences: 1,
        dryRun: true,
    });

    assert.ok(result.insights.removed_ai_phrases.some((item: any) => item.phrase === '当然可以'));
});

test('detects removed CTA phrase', async () => {
    const result = await mineDraftEdits({
        db: makeDb([feedback({ id: 'f1' })]),
        accountId: 'account-1',
        minOccurrences: 1,
        dryRun: true,
    });

    assert.ok(result.insights.removed_cta_phrases.some((item: any) => item.phrase === '欢迎访问我们的店铺'));
});

test('detects unnecessary question removed', async () => {
    const result = await mineDraftEdits({
        db: makeDb([feedback({ id: 'f1' })]),
        accountId: 'account-1',
        minOccurrences: 1,
        dryRun: true,
    });

    assert.ok(result.insights.removed_unnecessary_questions.some((item: any) => item.phrase === '你希望找到更适合你脸型的吗'));
});

test('detects shortened reply pattern', async () => {
    const result = await mineDraftEdits({
        db: makeDb([
            feedback({
                id: 'f1',
                original_draft_text: '当然可以，猫眼眼镜确实会给脸型带来独特的感觉。欢迎访问我们的店铺探索更多选择。',
                human_edited_text: '框偏大，换小一圈会自然很多。',
            }),
        ]),
        accountId: 'account-1',
        minOccurrences: 1,
        dryRun: true,
    });

    assert.equal(result.insights.shortened_reply_count, 1);
});

test('creates BANNED_PHRASE candidate draft', async () => {
    const result = await mineDraftEdits({
        db: makeDb([feedback({ id: 'f1' })]),
        accountId: 'account-1',
        minOccurrences: 1,
        dryRun: true,
    });

    assert.ok(result.candidate_drafts.some((row: any) =>
        row.candidate_type === 'BANNED_PHRASE' &&
        row.candidate_payload.phrase === '当然可以',
    ));
});

test('creates DRAFT_QC_TEST_CASE candidate draft for CTA removal', async () => {
    const result = await mineDraftEdits({
        db: makeDb([feedback({ id: 'f1' })]),
        accountId: 'account-1',
        minOccurrences: 1,
        dryRun: true,
    });

    const candidate = result.candidate_drafts.find((row: any) => row.candidate_type === 'DRAFT_QC_TEST_CASE');
    assert.equal(candidate.candidate_payload.target, 'cta_gating');
});

test('creates STYLE_GUIDANCE candidate for shortening', async () => {
    const result = await mineDraftEdits({
        db: makeDb([feedback({ id: 'f1' })]),
        accountId: 'account-1',
        minOccurrences: 1,
        dryRun: true,
    });

    assert.ok(result.candidate_drafts.some((row: any) => row.title === 'Review shortened reply style pattern'));
});

test('dryRun true does not persist', async () => {
    const db = makeDb([feedback({ id: 'f1' })]);

    const result = await mineDraftEdits({
        db,
        accountId: 'account-1',
        minOccurrences: 1,
        dryRun: true,
    });

    assert.equal(result.persisted_count, 0);
    assert.equal(db.applyCandidate.rows.length, 0);
});

test('dryRun false persists candidates', async () => {
    const db = makeDb([feedback({ id: 'f1' })]);

    const result = await mineDraftEdits({
        db,
        accountId: 'account-1',
        minOccurrences: 1,
        dryRun: false,
    });

    assert.ok(result.persisted_count > 0);
    assert.equal(db.applyCandidate.rows.length, result.persisted_count);
});

test('skips duplicate PENDING candidates', async () => {
    const db = makeDb([feedback({ id: 'f1' })]);
    await mineDraftEdits({
        db,
        accountId: 'account-1',
        minOccurrences: 1,
        dryRun: false,
    });
    const second = await mineDraftEdits({
        db,
        accountId: 'account-1',
        minOccurrences: 1,
        dryRun: false,
    });

    assert.equal(second.persisted_count, 0);
    assert.ok(second.skipped_duplicate_count > 0);
});

test('filters by brand and platform', async () => {
    const result = await mineDraftEdits({
        db: makeDb([
            feedback({ id: 'f1', brand_id: 'brand-1', platform: 'xiaohongshu' }),
            feedback({ id: 'f2', brand_id: 'brand-2', platform: 'xiaohongshu' }),
            feedback({ id: 'f3', brand_id: 'brand-1', platform: 'instagram' }),
        ]),
        accountId: 'account-1',
        brandId: 'brand-1',
        platform: 'xiaohongshu',
        minOccurrences: 1,
        dryRun: true,
    });

    assert.equal(result.insights.total_feedback, 1);
});

test('enforces account scope by only mining scoped account rows', async () => {
    const result = await mineDraftEdits({
        db: makeDb([
            feedback({ id: 'f1', account_id: 'account-1' }),
            feedback({ id: 'f2', account_id: 'account-2' }),
        ]),
        accountId: 'account-1',
        minOccurrences: 1,
        dryRun: true,
    });

    assert.equal(result.insights.total_feedback, 1);
});

test('route returns mined candidates', async (t) => {
    const restores: RestoreFn[] = [];
    t.after(() => restores.reverse().forEach((restore) => restore()));
    restores.push(stubMethod(SessionStore, 'getSession', (async () => activeSession()) as any));
    restores.push(stubMethod(prisma as any, 'draftFeedback', new FakeModel('feedback', [feedback({ id: 'f1' })]) as any));
    restores.push(stubMethod(prisma as any, 'applyCandidate', new FakeModel('candidate', []) as any));

    const app = createApp();
    const res = await request(app)
        .post('/learning-review/edit-mining/run')
        .set('Cookie', ['syntrae_session=session-1'])
        .send({
            brand_id: 'brand-1',
            platform: 'xiaohongshu',
            min_occurrences: 1,
            dry_run: true,
        });

    assert.equal(res.status, 200);
    assert.ok(res.body.candidate_drafts.length > 0);
    assert.equal(res.body.persisted_count, 0);
});
