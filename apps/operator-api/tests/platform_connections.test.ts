import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import request from 'supertest';

const storageRoot = mkdtempSync(path.join(os.tmpdir(), 'syntrae-platform-'));
process.env.AUTOMATION_STORAGE_ROOT = storageRoot;

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

test('platform connection status reports CONNECTED when the brand-scoped session file exists', async (t) => {
    const restores: RestoreFn[] = [];
    t.after(() => restores.reverse().forEach((restore) => restore()));

    const sessionPath = path.join(storageRoot, 'sessions', 'ws-1', 'brand-1', 'rednote', 'session.json');
    mkdirSync(path.dirname(sessionPath), { recursive: true });
    writeFileSync(sessionPath, JSON.stringify({ cookies: [] }), 'utf8');

    restores.push(stubMethod(SessionStore, 'getSession', (async () => activeSession('ws-1')) as any));
    restores.push(stubMethod(prisma.brand, 'findFirst', (async () => ({
        id: 'brand-1',
        workspace_id: 'ws-1',
        name: 'Acme Beauty',
    })) as any));
    restores.push(stubMethod(prisma.brandPlatformConnection, 'findUnique', (async () => null) as any));
    restores.push(stubMethod(prisma.brandPlatformConnection, 'upsert', (async ({ create, update }: any) => ({
        id: 'conn-1',
        ...create,
        ...update,
    })) as any));

    const app = createApp();
    const res = await request(app)
        .get('/brands/brand-1/platform-connections/rednote')
        .set('Cookie', ['syntrae_session=session-1']);

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'CONNECTED');
    assert.equal(res.body.session_present, true);
    assert.equal(res.body.active_session_path, sessionPath);
    assert.match(String(res.body.connect_command), /main_automation\.py login/);
});
