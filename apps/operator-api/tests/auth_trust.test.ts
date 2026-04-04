import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../src/index';
import { prisma } from '../src/db';
import { AuthService } from '../src/services/auth.service';
import { AuthTokenService } from '../src/services/auth_token.service';

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

test('login is blocked until the email is verified', async (t) => {
    const restores: RestoreFn[] = [];
    t.after(() => restores.reverse().forEach((restore) => restore()));

    restores.push(stubMethod(AuthService, 'isLocked', (async () => false) as any));
    restores.push(
        stubMethod(
            prisma.user,
            'findUnique',
            (async () => ({
                id: 'user-1',
                email: 'beta@test.local',
                password_hash: 'hashed',
                email_verified_at: null,
            })) as any
        )
    );

    const app = createApp();
    const res = await request(app)
        .post('/auth/login')
        .send({ email: 'beta@test.local', password: 'password123' });

    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'EMAIL_VERIFICATION_REQUIRED');
});

test('verify-email consumes a token and marks the user verified', async (t) => {
    const restores: RestoreFn[] = [];
    t.after(() => restores.reverse().forEach((restore) => restore()));

    let updatedUserId = '';
    restores.push(
        stubMethod(
            AuthTokenService,
            'consume',
            (async () => ({
                id: 'token-row',
                user_id: 'user-1',
                user: { id: 'user-1', email: 'beta@test.local' },
            })) as any
        )
    );
    restores.push(
        stubMethod(
            prisma.user,
            'update',
            (async ({ where }: any) => {
                updatedUserId = where.id;
                return { id: where.id };
            }) as any
        )
    );

    const app = createApp();
    const res = await request(app)
        .post('/auth/verify-email')
        .send({ token: 'verification-token' });

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'verified');
    assert.equal(updatedUserId, 'user-1');
});
