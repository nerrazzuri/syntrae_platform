import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import request from 'supertest';

const storageRoot = mkdtempSync(path.join(os.tmpdir(), 'syntrae-platform-'));
process.env.AUTOMATION_STORAGE_ROOT = storageRoot;

import { createApp } from '../src/index';
import { prisma } from '../src/db';
import { SessionStore } from '../src/services/auth/session_store';
import { PlatformConnectionService } from '../src/services/platform_connection.service';

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

test('platform connection ingest accepts a valid challenge and returns connected status', async (t) => {
    const restores: RestoreFn[] = [];
    t.after(() => restores.reverse().forEach((restore) => restore()));

    restores.push(stubMethod(PlatformConnectionService, 'ingestCookies', (async () => ({
        id: 'conn-1',
        platform: 'rednote',
        status: 'CONNECTED',
        active_session_path: '/tmp/session.json',
        session_present: true,
    })) as any));

    const app = createApp();
    const res = await request(app)
        .post('/platform-connections/rednote/ingest')
        .send({
            challenge_id: 'challenge-1',
            nonce: 'nonce-1',
            cookies: [
                { name: 'a1', value: 'cookie-a1' },
                { name: 'web_session', value: 'cookie-session' },
            ],
        });

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'CONNECTED');
    assert.equal(res.body.platform, 'rednote');
});

test('platform connection disconnect removes scoped and legacy session files', async (t) => {
    const restores: RestoreFn[] = [];
    t.after(() => restores.reverse().forEach((restore) => restore()));

    const scopedPath = path.join(storageRoot, 'sessions', 'ws-1', 'brand-1', 'rednote', 'session.json');
    const legacyPath = path.join(storageRoot, 'sessions', 'brand-1', 'rednote', 'session.json');
    mkdirSync(path.dirname(scopedPath), { recursive: true });
    mkdirSync(path.dirname(legacyPath), { recursive: true });
    writeFileSync(scopedPath, JSON.stringify({ cookies: [{ name: 'web_session', value: 'old' }] }), 'utf8');
    writeFileSync(legacyPath, JSON.stringify({ cookies: [{ name: 'web_session', value: 'legacy' }] }), 'utf8');

    let storedConnection: any = {
        id: 'conn-1',
        workspace_id: 'ws-1',
        brand_id: 'brand-1',
        platform: 'rednote',
        provider: 'COOKIE_CAPTURE',
        auth_type: 'COOKIE_BLOB',
        status: 'CONNECTED',
        session_path: scopedPath,
        encrypted_session_payload: null,
        session_version: 1,
        session_updated_at: new Date(),
        connected_at: new Date(),
        last_checked_at: new Date(),
        last_verified_at: new Date(),
        verification_error: null,
        expires_at: null,
        last_error: null,
        metadata: {},
    };

    restores.push(stubMethod(prisma.brand, 'findFirst', (async () => ({
        id: 'brand-1',
        workspace_id: 'ws-1',
        name: 'Acme Beauty',
    })) as any));
    restores.push(stubMethod(prisma.brandPlatformConnection, 'findUnique', (async () => storedConnection) as any));
    restores.push(stubMethod(prisma.brandPlatformConnection, 'upsert', (async ({ create, update }: any) => {
        storedConnection = { id: 'conn-1', ...storedConnection, ...create, ...update };
        return storedConnection;
    }) as any));

    const result = await PlatformConnectionService.disconnect('ws-1', 'brand-1', 'rednote');

    assert.equal(existsSync(scopedPath), false);
    assert.equal(existsSync(legacyPath), false);
    assert.equal(result.status, 'DISCONNECTED');
    assert.equal(result.session_present, false);
    assert.equal(result.encrypted_session_payload, null);
});

test('platform connection request clears existing session files before recapture', async (t) => {
    const restores: RestoreFn[] = [];
    t.after(() => restores.reverse().forEach((restore) => restore()));

    const scopedPath = path.join(storageRoot, 'sessions', 'ws-1', 'brand-replace', 'rednote', 'session.json');
    const legacyPath = path.join(storageRoot, 'sessions', 'brand-replace', 'rednote', 'session.json');
    mkdirSync(path.dirname(scopedPath), { recursive: true });
    mkdirSync(path.dirname(legacyPath), { recursive: true });
    writeFileSync(scopedPath, JSON.stringify({ cookies: [{ name: 'web_session', value: 'banned' }] }), 'utf8');
    writeFileSync(legacyPath, JSON.stringify({ cookies: [{ name: 'web_session', value: 'legacy-banned' }] }), 'utf8');

    let storedConnection: any = {
        id: 'conn-replace',
        workspace_id: 'ws-1',
        brand_id: 'brand-replace',
        platform: 'rednote',
        provider: 'COOKIE_CAPTURE',
        auth_type: 'COOKIE_BLOB',
        status: 'CONNECTED',
        session_path: scopedPath,
        encrypted_session_payload: 'old-encrypted-payload',
        session_version: 1,
        session_updated_at: new Date(),
        connected_at: new Date(),
        last_checked_at: new Date(),
        last_verified_at: new Date(),
        verification_error: null,
        expires_at: null,
        last_error: null,
        metadata: { captured_cookie_names: ['web_session'] },
    };

    restores.push(stubMethod(prisma.brand, 'findFirst', (async () => ({
        id: 'brand-replace',
        workspace_id: 'ws-1',
        name: 'Acme Beauty',
    })) as any));
    restores.push(stubMethod(prisma.brandPlatformConnection, 'findUnique', (async () => storedConnection) as any));
    restores.push(stubMethod(prisma.brandPlatformConnection, 'upsert', (async ({ create, update }: any) => {
        storedConnection = { id: 'conn-replace', ...storedConnection, ...create, ...update };
        return storedConnection;
    }) as any));

    const result = await PlatformConnectionService.requestConnection('ws-1', 'brand-replace', 'rednote');

    assert.equal(existsSync(scopedPath), false);
    assert.equal(existsSync(legacyPath), false);
    assert.equal(result.status, 'PENDING');
    assert.equal(result.session_present, false);
    assert.equal(result.encrypted_session_payload, null);
    assert.equal(result.connected_at, null);
    assert.equal(result.last_verified_at, null);
    assert.equal(result.verification_error, null);
});
