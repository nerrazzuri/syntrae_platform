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

test('onboarding status returns checklist progress for an incomplete workspace', async (t) => {
    const restores: RestoreFn[] = [];
    t.after(() => restores.reverse().forEach((restore) => restore()));

    restores.push(stubMethod(SessionStore, 'getSession', (async () => activeSession('ws-1')) as any));
    restores.push(stubMethod(prisma.account, 'findUnique', (async () => ({
        id: 'ws-1',
        name: 'Acme',
        onboarding_state: 'CREATED',
        plan_id: 'PRO',
        status: 'ACTIVE',
    })) as any));
    restores.push(stubMethod(prisma.brand, 'findMany', (async () => ([
        { id: 'brand-1', name: 'Default Brand', domain: 'general', status: 'ACTIVE' },
    ])) as any));
    restores.push(stubMethod(prisma.ownerSettings, 'findUnique', (async () => ({
        platforms_enabled: '[]',
    })) as any));
    restores.push(stubMethod(prisma.marketProfile, 'findFirst', (async () => null) as any));

    const app = createApp();
    const res = await request(app)
        .get('/onboarding/status')
        .set('Cookie', ['syntrae_session=session-1']);

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.checklist, {
        brand_basics: false,
        platform_selection: false,
        market_profile: false,
    });
    assert.equal(res.body.is_complete, false);
});

test('onboarding complete marks the workspace onboarded once required setup exists', async (t) => {
    const restores: RestoreFn[] = [];
    t.after(() => restores.reverse().forEach((restore) => restore()));

    let updatedWorkspaceId = '';

    restores.push(stubMethod(SessionStore, 'getSession', (async () => activeSession('ws-1')) as any));
    restores.push(stubMethod(prisma.brand, 'findMany', (async () => ([
        { id: 'brand-1', name: 'Acme Beauty', domain: 'acmebeauty.com' },
    ])) as any));
    restores.push(stubMethod(prisma.ownerSettings, 'findUnique', (async () => ({
        platforms_enabled: '["rednote"]',
    })) as any));
    restores.push(stubMethod(prisma.marketProfile, 'findFirst', (async () => ({
        id: 'profile-1',
    })) as any));
    restores.push(stubMethod(prisma.account, 'update', (async ({ where }: any) => {
        updatedWorkspaceId = where.id;
        return { id: where.id, onboarding_state: 'ONBOARDED' };
    }) as any));

    const app = createApp();
    const res = await request(app)
        .post('/onboarding/complete')
        .set('Cookie', ['syntrae_session=session-1'])
        .send({});

    assert.equal(res.status, 200);
    assert.equal(res.body.onboarding_state, 'ONBOARDED');
    assert.equal(updatedWorkspaceId, 'ws-1');
});
