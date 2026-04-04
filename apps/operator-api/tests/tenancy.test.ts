import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

process.env.AI_CORE_INTERNAL_SECRET = process.env.AI_CORE_INTERNAL_SECRET || 'test-internal-secret';

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

function activeSession(workspaceId: string) {
    return {
        id: 'session-1',
        user_id: 'user-1',
        active_workspace_id: workspaceId,
        expires_at: new Date(Date.now() + 60_000),
        last_seen_at: new Date(),
        created_at: new Date(),
        user: {
            id: 'user-1',
            email: 'beta@test.local',
        },
        active_workspace: {
            id: workspaceId,
            status: 'ACTIVE',
        },
    } as any;
}

test('market profile list returns 404 for a foreign workspace brand', async (t) => {
    const restores: RestoreFn[] = [];
    t.after(() => restores.reverse().forEach((restore) => restore()));

    restores.push(stubMethod(SessionStore, 'getSession', (async () => activeSession('ws-1')) as any));
    restores.push(stubMethod(prisma.brand, 'findFirst', (async () => null) as any));

    const app = createApp();
    const res = await request(app)
        .get('/brands/brand-foreign/market-profiles')
        .set('Cookie', ['syntrae_session=session-1']);

    assert.equal(res.status, 404);
    assert.match(String(res.body.error), /Brand not found|access denied/i);
});

test('market profile create succeeds for a brand owned by the active workspace', async (t) => {
    const restores: RestoreFn[] = [];
    t.after(() => restores.reverse().forEach((restore) => restore()));

    restores.push(stubMethod(SessionStore, 'getSession', (async () => activeSession('ws-1')) as any));
    restores.push(stubMethod(prisma.brand, 'findFirst', (async () => ({ id: 'brand-1' })) as any));
    restores.push(stubMethod(prisma.marketProfile, 'create', (async ({ data }: any) => ({ id: 'profile-1', ...data })) as any));

    const app = createApp();
    const res = await request(app)
        .post('/brands/brand-1/market-profiles')
        .set('Cookie', ['syntrae_session=session-1'])
        .send({
            name: 'Core Profile',
            primary_category: 'BEAUTY',
            target_audience: 'Test Audience',
            languages: ['en'],
            keywords_positive: ['serum', 'skincare', 'beauty'],
            keywords_negative: ['cheap'],
            hashtags_positive: ['skin'],
            hashtags_negative: ['spam'],
            excluded_topics: [],
            discovery_intent: 'BALANCED',
        });

    assert.equal(res.status, 201);
    assert.equal(res.body.brand_id, 'brand-1');
});

test('policy fetch returns 404 for an install that is not authorized for the brand', async () => {
    const restore = stubMethod(prisma.installRegistry, 'findFirst', (async () => null) as any);
    try {
        const app = createApp();
        const res = await request(app)
            .get('/brands/brand-foreign/automation-policy')
            .set('x-install-id', 'install-foreign');

        assert.equal(res.status, 404);
        assert.match(String(res.body.error), /not authorized|Brand not found|access/i);
    } finally {
        restore();
    }
});

test('policy update returns 404 when the active workspace does not own the brand', async (t) => {
    const restores: RestoreFn[] = [];
    t.after(() => restores.reverse().forEach((restore) => restore()));

    restores.push(stubMethod(SessionStore, 'getSession', (async () => activeSession('ws-1')) as any));
    restores.push(stubMethod(prisma.brand, 'findFirst', (async () => null) as any));

    const app = createApp();
    const res = await request(app)
        .put('/brands/brand-foreign/automation-policy')
        .set('Cookie', ['syntrae_session=session-1'])
        .send({ status: 'ACTIVE', relevance_min_score: 80 });

    assert.equal(res.status, 404);
    assert.match(String(res.body.error), /Brand not found|access denied/i);
});

test('run queue returns 404 when the active workspace does not own the brand', async (t) => {
    const restores: RestoreFn[] = [];
    t.after(() => restores.reverse().forEach((restore) => restore()));

    restores.push(stubMethod(SessionStore, 'getSession', (async () => activeSession('ws-1')) as any));
    restores.push(stubMethod(prisma.brand, 'findFirst', (async () => null) as any));

    const app = createApp();
    const res = await request(app)
        .post('/brands/brand-foreign/runs/queue')
        .set('Cookie', ['syntrae_session=session-1'])
        .send({ platform: 'tiktok' });

    assert.equal(res.status, 404);
    assert.match(String(res.body.error), /Brand not found|access denied/i);
});

test('agent automation-run creation returns 404 for an unauthorized install-brand pairing', async () => {
    const restore = stubMethod(prisma.installRegistry, 'findFirst', (async () => null) as any);
    try {
        const app = createApp();
        const res = await request(app)
            .post('/brands/brand-foreign/automation-runs')
            .set('x-install-id', 'install-foreign')
            .send({ platform: 'tiktok', policy_snapshot: {} });

        assert.equal(res.status, 404);
        assert.match(String(res.body.error), /not authorized|access/i);
    } finally {
        restore();
    }
});

test('run update returns 404 when the run does not belong to the requested brand', async (t) => {
    const restores: RestoreFn[] = [];
    t.after(() => restores.reverse().forEach((restore) => restore()));

    restores.push(stubMethod(prisma.installRegistry, 'findFirst', (async () => ({ id: 'install-row' })) as any));
    restores.push(stubMethod(prisma.automationRun, 'findUnique', (async () => ({ id: 'run-1', brand_id: 'brand-other' })) as any));

    const app = createApp();
    const res = await request(app)
        .put('/brands/brand-1/automation-runs/run-1')
        .set('x-install-id', 'install-1')
        .send({ status: 'COMPLETED' });

    assert.equal(res.status, 404);
    assert.match(String(res.body.error), /Run not found|access denied/i);
});

test('internal automation claim uses internal secret auth instead of session auth', async () => {
    const app = createApp();
    const res = await request(app)
        .post('/internal/automation-runs/claim')
        .set('x-internal-secret', process.env.AI_CORE_INTERNAL_SECRET!)
        .send({ worker_id: 'worker-1', lease_seconds: 120 });

    assert.notEqual(res.status, 401);
    assert.notEqual(res.body?.error, 'Unauthorized: No Session (Cookie or Token)');
});
