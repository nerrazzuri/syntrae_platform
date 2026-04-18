import test from 'node:test';
import assert from 'node:assert/strict';

import { LeadQuotaService } from '../src/services/billing/lead_quota.service';
import { LeadCreditLedgerService } from '../src/services/billing/lead_credit_ledger.service';
import { SubscriptionPolicyService } from '../src/services/billing/subscription_policy.service';

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

test('lead quota snapshot is derived from the credit ledger breakdown', async (t) => {
    const restores: RestoreFn[] = [];
    t.after(() => restores.reverse().forEach((restore) => restore()));

    restores.push(stubMethod(SubscriptionPolicyService, 'getEffectivePlan', (async () => ({
        plan: { code: 'STARTER' },
    })) as any));
    restores.push(stubMethod(LeadCreditLedgerService, 'getQuotaBreakdown', (async () => ({
        used: 45,
        included: 50,
        rollover: 10,
        extra: 100,
        limit: 160,
        remaining: 115,
        periodStart: new Date('2026-04-01T00:00:00.000Z'),
        nextResetAt: new Date('2026-05-01T00:00:00.000Z'),
    })) as any));

    const snapshot = await LeadQuotaService.getQuotaSnapshot('ws-1');
    assert.equal(snapshot.used, 45);
    assert.equal(snapshot.included, 50);
    assert.equal(snapshot.rollover, 10);
    assert.equal(snapshot.extra, 100);
    assert.equal(snapshot.limit, 160);
    assert.equal(snapshot.remaining, 115);
    assert.equal(snapshot.overage_blocks_purchased, 1);
    assert.equal(snapshot.auto_extension_enabled, false);
  });

test('reserve lead capacity returns a typed quota error when the ledger is exhausted', async (t) => {
    const restores: RestoreFn[] = [];
    t.after(() => restores.reverse().forEach((restore) => restore()));

    restores.push(stubMethod(SubscriptionPolicyService, 'getEffectivePlan', (async () => ({
        plan: { code: 'STARTER' },
    })) as any));
    restores.push(stubMethod(LeadCreditLedgerService, 'reserveLeadCapture', (async () => ({
        consumed: false,
        snapshot: {
            used: 150,
            included: 50,
            rollover: 0,
            extra: 100,
            limit: 150,
            remaining: 0,
            periodStart: new Date('2026-04-01T00:00:00.000Z'),
            nextResetAt: new Date('2026-05-01T00:00:00.000Z'),
        },
    })) as any));

    const result = await LeadQuotaService.reserveLeadCapacity('ws-1');
    assert.equal(result.allowed, false);
    assert.equal(result.reason_code, 'LEAD_QUOTA_REACHED');
    assert.match(result.message || '', /Buy a 100-lead block or upgrade/i);
    assert.equal(result.quota.remaining, 0);
});
