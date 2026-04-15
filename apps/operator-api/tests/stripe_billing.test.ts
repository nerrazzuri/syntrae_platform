import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../src/index';
import { SessionStore } from '../src/services/auth/session_store';
import { LeadQuotaService } from '../src/services/billing/lead_quota.service';
import { StripeBillingError, StripeBillingService } from '../src/services/billing/stripe_billing.service';

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
            email: 'billing@test.local',
        },
        active_workspace: {
            id: workspaceId,
            name: 'Acme Workspace',
            status: 'ACTIVE',
        },
    } as any;
}

test('checkout session route returns a Stripe URL for the active workspace', async (t) => {
    const restores: RestoreFn[] = [];
    t.after(() => restores.reverse().forEach((restore) => restore()));

    restores.push(stubMethod(SessionStore, 'getSession', (async () => activeSession('ws-1')) as any));

    let received: any = null;
    restores.push(
        stubMethod(
            StripeBillingService,
            'createCheckoutSession',
            (async (input: any) => {
                received = input;
                return { url: 'https://checkout.stripe.test/session_123', session_id: 'cs_test_123' };
            }) as any
        )
    );

    const app = createApp();
    const res = await request(app)
        .post('/billing/checkout-session')
        .set('Cookie', ['syntrae_session=session-1'])
        .send({ plan_code: 'PRO', billing_interval: 'YEARLY' });

    assert.equal(res.status, 200);
    assert.equal(res.body.url, 'https://checkout.stripe.test/session_123');
    assert.equal(received.workspaceId, 'ws-1');
    assert.equal(received.userEmail, 'billing@test.local');
    assert.equal(received.planCode, 'PRO');
    assert.equal(received.billingInterval, 'YEARLY');
});

test('portal session route returns typed Stripe errors', async (t) => {
    const restores: RestoreFn[] = [];
    t.after(() => restores.reverse().forEach((restore) => restore()));

    restores.push(stubMethod(SessionStore, 'getSession', (async () => activeSession('ws-1')) as any));
    restores.push(
        stubMethod(
            StripeBillingService,
            'createPortalSession',
            (async () => {
                throw new StripeBillingError('STRIPE_CUSTOMER_NOT_LINKED', 'No Stripe customer linked to this workspace yet', 409);
            }) as any
        )
    );

    const app = createApp();
    const res = await request(app)
        .post('/billing/portal-session')
        .set('Cookie', ['syntrae_session=session-1'])
        .send({});

    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'STRIPE_CUSTOMER_NOT_LINKED');
});

test('lead auto extension route returns a typed unavailable error', async (t) => {
    const restores: RestoreFn[] = [];
    t.after(() => restores.reverse().forEach((restore) => restore()));

    restores.push(stubMethod(SessionStore, 'getSession', (async () => activeSession('ws-1')) as any));
    restores.push(
        stubMethod(
            LeadQuotaService,
            'setAutoExtension',
            (async () => {
                const error = new Error('Lead auto extension is not available. Upgrade before lead capture resumes after the monthly quota is reached.');
                (error as Error & { code?: string }).code = 'LEAD_AUTO_EXTENSION_UNAVAILABLE';
                throw error;
            }) as any
        )
    );

    const app = createApp();
    const res = await request(app)
        .post('/billing/lead-auto-extension')
        .set('Cookie', ['syntrae_session=session-1'])
        .send({ enabled: true });

    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'LEAD_AUTO_EXTENSION_UNAVAILABLE');
});

test('stripe webhook route is mounted before session auth and accepts raw payloads', async (t) => {
    const restores: RestoreFn[] = [];
    t.after(() => restores.reverse().forEach((restore) => restore()));

    let receivedPayload = '';
    let receivedSignature = '';
    restores.push(
        stubMethod(
            StripeBillingService,
            'handleWebhook',
            (async (payload: Buffer, signature?: string) => {
                receivedPayload = payload.toString('utf8');
                receivedSignature = signature || '';
                return { received: true };
            }) as any
        )
    );

    const app = createApp();
    const res = await request(app)
        .post('/billing/webhooks/stripe')
        .set('stripe-signature', 'sig_test_123')
        .set('Content-Type', 'application/json')
        .send(Buffer.from('{"type":"checkout.session.completed"}'));

    assert.equal(res.status, 200);
    assert.equal(res.body.received, true);
    assert.equal(receivedSignature, 'sig_test_123');
    assert.equal(receivedPayload, '{"type":"checkout.session.completed"}');
});
