import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import {
    canAccessAdvancedScoring,
    canCreateAdditionalBrand,
    canCreateAutomationRun,
    canExportLeads,
    canInviteTeamMember,
    canUsePlatform,
    evaluateUsage,
    LIMIT_PERIODS,
    normalizePlanCode,
    PLAN_CODES,
    USAGE_METRICS,
} from '@syntrae/commercial-plans';
import { createApp } from '../src/index';
import { SubscriptionPolicyError, SubscriptionPolicyService } from '../src/services/billing/subscription_policy.service';
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

test('legacy plan ids normalize into the commercial package set', () => {
    assert.equal(normalizePlanCode('FREE'), PLAN_CODES.STARTER);
    assert.equal(normalizePlanCode('basic'), PLAN_CODES.GROWTH);
    assert.equal(normalizePlanCode('BUSINESS'), PLAN_CODES.AGENCY);
    assert.equal(normalizePlanCode('unknown-value'), PLAN_CODES.STARTER);
});

test('starter restrictions and growth/pro/agency capabilities resolve correctly', () => {
    assert.equal(canUsePlatform(PLAN_CODES.STARTER, 'tiktok').allowed, true);
    assert.equal(canUsePlatform(PLAN_CODES.STARTER, 'rednote').allowed, false);
    assert.equal(canCreateAutomationRun(PLAN_CODES.STARTER).allowed, false);
    assert.equal(canExportLeads(PLAN_CODES.STARTER).allowed, false);
    assert.equal(canAccessAdvancedScoring(PLAN_CODES.GROWTH).allowed, true);
    assert.equal(canCreateAutomationRun(PLAN_CODES.GROWTH).allowed, false);
    assert.equal(canCreateAutomationRun(PLAN_CODES.PRO).allowed, true);
    assert.equal(canCreateAdditionalBrand(PLAN_CODES.AGENCY, 29).allowed, true);
    assert.equal(canCreateAdditionalBrand(PLAN_CODES.AGENCY, 30).allowed, false);
    assert.equal(canInviteTeamMember(PLAN_CODES.AGENCY, 24).allowed, true);
    assert.equal(canInviteTeamMember(PLAN_CODES.AGENCY, 25).allowed, false);
});

test('usage evaluation blocks when the package quota is exceeded', () => {
    const starterDaily = evaluateUsage(PLAN_CODES.STARTER, USAGE_METRICS.EVENTS_INGESTED, LIMIT_PERIODS.DAILY, 150, 1);
    assert.equal(starterDaily.allowed, false);
    assert.equal(starterDaily.reasonCode, 'PLAN_LIMIT_REACHED');

    const proRuns = evaluateUsage(PLAN_CODES.PRO, USAGE_METRICS.AUTOMATION_RUNS_CREATED, LIMIT_PERIODS.DAILY, 24, 1);
    assert.equal(proRuns.allowed, true);

    const agencyExports = evaluateUsage(PLAN_CODES.AGENCY, USAGE_METRICS.LEADS_EXPORTED, LIMIT_PERIODS.MONTHLY, 25000, 1);
    assert.equal(agencyExports.allowed, false);
});

test('run queue returns a typed 403 when the plan blocks automation', async (t) => {
    const restores: RestoreFn[] = [];
    t.after(() => restores.reverse().forEach((restore) => restore()));

    restores.push(stubMethod(SessionStore, 'getSession', (async () => activeSession('ws-1')) as any));
    restores.push(stubMethod(prisma.brand, 'findFirst', (async () => ({ id: 'brand-1' })) as any));
    restores.push(
        stubMethod(
            SubscriptionPolicyService,
            'assertCanCreateAutomationRun',
            (async () => {
                throw new SubscriptionPolicyError('AUTOMATION_DISABLED', 'Starter does not include automation runs.');
            }) as any
        )
    );

    const app = createApp();
    const res = await request(app)
        .post('/brands/brand-1/runs/queue')
        .set('Cookie', ['syntrae_session=session-1'])
        .send({ platform: 'tiktok' });

    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'AUTOMATION_DISABLED');
});
