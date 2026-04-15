import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../src/index';
import { getSessionTtlHours, getSessionTtlMs } from '../src/services/auth/session_store';

type RestoreFn = () => void;

function setEnv(key: string, value: string | undefined): RestoreFn {
    const original = process.env[key];
    if (value === undefined) {
        delete process.env[key];
    } else {
        process.env[key] = value;
    }
    return () => {
        if (original === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = original;
        }
    };
}

test('signup is closed when beta signup is enabled but allowlist is empty', async (t) => {
    const restores: RestoreFn[] = [];
    t.after(() => restores.reverse().forEach((restore) => restore()));

    restores.push(setEnv('BETA_SIGNUP_ENABLED', 'true'));
    restores.push(setEnv('BETA_SIGNUP_ALLOWLIST', ''));

    const app = createApp();
    const res = await request(app)
        .post('/auth/signup')
        .send({
            email: 'beta@test.local',
            password: 'password123',
            workspace_name: 'Acme',
        });

    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'Signup is closed for this beta cohort');
});

test('session ttl helpers default to seven days and accept env override', async (t) => {
    const restores: RestoreFn[] = [];
    t.after(() => restores.reverse().forEach((restore) => restore()));

    restores.push(setEnv('SESSION_TTL_HOURS', undefined));
    assert.equal(getSessionTtlHours(), 168);
    assert.equal(getSessionTtlMs(), 168 * 60 * 60 * 1000);

    restores.push(setEnv('SESSION_TTL_HOURS', '48'));
    assert.equal(getSessionTtlHours(), 48);
    assert.equal(getSessionTtlMs(), 48 * 60 * 60 * 1000);
});
