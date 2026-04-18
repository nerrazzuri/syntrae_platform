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
import { LeadQuotaService } from '../src/services/billing/lead_quota.service';
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
    assert.equal(normalizePlanCode('FREE'), PLAN_CODES.BASIC);
    assert.equal(normalizePlanCode('basic'), PLAN_CODES.BASIC);
    assert.equal(normalizePlanCode('BUSINESS'), PLAN_CODES.AGENCY);
    assert.equal(normalizePlanCode('unknown-value'), PLAN_CODES.BASIC);
});

test('starter restrictions and growth/pro/agency capabilities resolve correctly', () => {
    assert.equal(canUsePlatform(PLAN_CODES.BASIC, 'rednote').allowed, true);
    assert.equal(canUsePlatform(PLAN_CODES.BASIC, 'tiktok').allowed, false);
    assert.equal(canCreateAutomationRun(PLAN_CODES.BASIC).allowed, true);
    assert.equal(canUsePlatform(PLAN_CODES.STARTER, 'tiktok').allowed, true);
    assert.equal(canUsePlatform(PLAN_CODES.STARTER, 'rednote').allowed, true);
    assert.equal(canUsePlatform(PLAN_CODES.STARTER, 'xiaohongshu').allowed, true);
    assert.equal(canCreateAutomationRun(PLAN_CODES.STARTER).allowed, true);
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
    const basicDaily = evaluateUsage(PLAN_CODES.BASIC, USAGE_METRICS.EVENTS_INGESTED, LIMIT_PERIODS.DAILY, 10, 1);
    assert.equal(basicDaily.allowed, false);
    assert.equal(basicDaily.reasonCode, 'PLAN_LIMIT_REACHED');

    const proRuns = evaluateUsage(PLAN_CODES.PRO, USAGE_METRICS.AUTOMATION_RUNS_CREATED, LIMIT_PERIODS.DAILY, 24, 1);
    assert.equal(proRuns.allowed, true);

    const agencyExports = evaluateUsage(PLAN_CODES.AGENCY, USAGE_METRICS.LEADS_EXPORTED, LIMIT_PERIODS.MONTHLY, 25000, 1);
    assert.equal(agencyExports.allowed, false);
});

test('automation run creation is blocked when monthly lead quota is exhausted', async (t) => {
    const restores: RestoreFn[] = [];
    t.after(() => restores.reverse().forEach((restore) => restore()));

    restores.push(
        stubMethod(
            SubscriptionPolicyService,
            'getEffectivePlan',
            (async () => ({
                plan: { code: PLAN_CODES.STARTER, displayName: 'Starter' },
                subscription: {},
                source: 'subscription',
            })) as any
        )
    );
    restores.push(
        stubMethod(
            LeadQuotaService,
            'getQuotaSnapshot',
            (async () => ({
                used: 50,
                included: 50,
                rollover: 0,
                extra: 0,
                limit: 50,
                remaining: 0,
                auto_extension_enabled: false,
                warning_threshold: 0.8,
                warning_reached: true,
                next_reset_at: new Date('2026-05-01T00:00:00.000Z').toISOString(),
                overage_block_size: 100,
                overage_block_price_minor: 6900,
                overage_currency: 'MYR',
                overage_blocks_purchased: 0,
                last_auto_charge_at: null,
                last_invoice_id: null,
            })) as any
        )
    );

    await assert.rejects(
        () => SubscriptionPolicyService.assertCanCreateAutomationRun('ws-1', 'rednote'),
        (error: any) => {
            assert.equal(error instanceof SubscriptionPolicyError, true);
            assert.equal(error.code, 'LEAD_QUOTA_REACHED');
            assert.match(error.message, /Extend a 100-lead block or upgrade to a higher plan/i);
            return true;
        }
    );
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
