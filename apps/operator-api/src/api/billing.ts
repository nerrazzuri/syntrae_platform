import { Router, Request, Response } from 'express';
import { requireSession } from '../middleware/session_auth';
import { BillingService } from '../services/billing/billing_service';
import { SubscriptionPolicyService } from '../services/billing/subscription_policy.service';
import { BILLING_INTERVALS, PLAN_CODES, type BillingInterval } from '@syntrae/commercial-plans';
import { StripeBillingError, StripeBillingService } from '../services/billing/stripe_billing.service';

const router = Router();

export const stripeWebhookHandler = async (req: Request, res: Response) => {
    try {
        const signature = req.headers['stripe-signature'];
        const sigHeader = Array.isArray(signature) ? signature[0] : signature;
        const payload = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');

        const result = await StripeBillingService.handleWebhook(payload, sigHeader);
        res.json(result);
    } catch (err) {
        if (err instanceof StripeBillingError) {
            res.status(err.statusCode).json({ error: err.message, code: err.code });
            return;
        }

        console.error('[Billing] Stripe Webhook Error:', err);
        res.status(400).json({ error: 'Unable to process Stripe webhook' });
    }
};

router.use(requireSession);

router.get('/subscription', async (req: Request, res: Response) => {
    try {
        const workspaceId = req.session?.active_workspace_id;
        if (!workspaceId) {
            res.status(400).json({ error: 'No active workspace selected' });
            return;
        }

        const summary = await SubscriptionPolicyService.getWorkspacePlanSummary(workspaceId);
        res.json(summary);
    } catch (err) {
        console.error('[Billing] Subscription Summary Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

router.post('/checkout-session', async (req: Request, res: Response) => {
    try {
        const workspaceId = req.session?.active_workspace_id;
        const user = req.user;
        const billingInterval = (req.body?.billing_interval || BILLING_INTERVALS.MONTHLY) as BillingInterval;
        const planCode = req.body?.plan_code;
        const voucherCode = String(req.body?.voucher_code || '').trim();

        if (!workspaceId || !user) {
            res.status(400).json({ error: 'Missing billing session context' });
            return;
        }
        if (!planCode) {
            res.status(400).json({ error: 'Missing plan_code' });
            return;
        }

        const session = await StripeBillingService.createCheckoutSession({
            workspaceId,
            userEmail: user.email,
            userId: user.id,
            planCode,
            billingInterval,
            voucherCode,
        });

        res.json(session);
    } catch (err) {
        if (err instanceof StripeBillingError) {
            res.status(err.statusCode).json({ error: err.message, code: err.code });
            return;
        }
        console.error('[Billing] Checkout Session Error:', err);
        res.status(500).json({ error: 'Unable to create checkout session' });
    }
});

router.post('/portal-session', async (req: Request, res: Response) => {
    try {
        const workspaceId = req.session?.active_workspace_id;
        if (!workspaceId) {
            res.status(400).json({ error: 'No active workspace selected' });
            return;
        }

        const session = await StripeBillingService.createPortalSession({ workspaceId });
        res.json(session);
    } catch (err) {
        if (err instanceof StripeBillingError) {
            res.status(err.statusCode).json({ error: err.message, code: err.code });
            return;
        }
        console.error('[Billing] Portal Session Error:', err);
        res.status(500).json({ error: 'Unable to create billing portal session' });
    }
});

router.post('/change-plan', async (req: Request, res: Response) => {
    try {
        const workspaceId = req.session?.active_workspace_id;
        const { plan_code } = req.body;

        if (!workspaceId || !plan_code) {
            res.status(400).json({ error: 'Missing workspace or plan_code' });
            return;
        }
        if (!StripeBillingService.manualPlanChangesAllowed()) {
            res.status(403).json({ error: 'Manual plan changes are disabled when Stripe billing is active', code: 'MANUAL_BILLING_DISABLED' });
            return;
        }

        const result = await BillingService.changePlan(workspaceId, plan_code);
        res.json({
            status: 'success',
            plan: result.plan.code,
            display_name: result.plan.displayName,
        });
    } catch (err: any) {
        console.error('[Billing] Change Plan Error:', err);
        res.status(400).json({ error: err.message || 'Unable to change plan' });
    }
});

// POST /billing/upgrade
router.post('/upgrade', async (req: Request, res: Response) => {
    try {
        const workspaceId = req.session?.active_workspace_id;

        if (!workspaceId) {
            res.status(400).json({ error: 'No active workspace selected' });
            return;
        }
        if (!StripeBillingService.manualPlanChangesAllowed()) {
            res.status(403).json({ error: 'Manual upgrades are disabled when Stripe billing is active', code: 'MANUAL_BILLING_DISABLED' });
            return;
        }

        const result = await BillingService.changePlan(workspaceId, PLAN_CODES.PRO);
        res.json({ status: 'success', plan: result.plan.code, display_name: result.plan.displayName });
    } catch (err) {
        console.error('[Billing] Upgrade Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST /billing/downgrade
router.post('/downgrade', async (req: Request, res: Response) => {
    try {
        const workspaceId = req.session?.active_workspace_id;
        if (!workspaceId) {
            res.status(400).json({ error: 'No active workspace selected' });
            return;
        }
        if (!StripeBillingService.manualPlanChangesAllowed()) {
            res.status(403).json({ error: 'Manual downgrades are disabled when Stripe billing is active', code: 'MANUAL_BILLING_DISABLED' });
            return;
        }

        const result = await BillingService.downgradeToPlan(workspaceId, PLAN_CODES.STARTER);
        res.json({
            status: 'success',
            plan: result.plan_id,
            account_status: result.status
        });
    } catch (err) {
        console.error('[Billing] Downgrade Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST /billing/resolve-downgrade
router.post('/resolve-downgrade', async (req: Request, res: Response) => {
    try {
        const { keep_brand_id } = req.body;
        const workspaceId = req.session?.active_workspace_id;

        if (!workspaceId || !keep_brand_id) {
            res.status(400).json({ error: 'Missing workspace or brand selection' });
            return;
        }
        if (!StripeBillingService.manualPlanChangesAllowed()) {
            res.status(403).json({ error: 'Manual downgrades are disabled when Stripe billing is active', code: 'MANUAL_BILLING_DISABLED' });
            return;
        }

        const result = await BillingService.resolveDowngrade(workspaceId, keep_brand_id);
        res.json({
            status: 'success',
            plan: result.plan_id,
            account_status: result.status
        });
    } catch (err) {
        console.error('[Billing] Resolve Downgrade Error:', err);
        res.status(400).json({ error: (err as Error).message });
    }
});

export const billingRouter = router;
