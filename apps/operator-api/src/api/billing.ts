import { Router, Request, Response } from 'express';
import { requireSession } from '../middleware/session_auth';
import { BillingService } from '../services/billing/billing_service';

const router = Router();

router.use(requireSession);

// POST /billing/upgrade
router.post('/upgrade', async (req: Request, res: Response) => {
    try {
        const userId = req.user!.id;
        // In real system, this checks Stripe payment status.
        // For Phase 35, it's a manual trigger.
        // We assume the active workspace of the user context (or passed ID).
        // Let's use session's active workspace.
        const workspaceId = req.session?.active_workspace_id;

        if (!workspaceId) {
            res.status(400).json({ error: 'No active workspace selected' });
            return;
        }

        const result = await BillingService.upgradeToPro(workspaceId);
        res.json({ status: 'success', plan: result.plan_id });
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

        const result = await BillingService.downgradeToFree(workspaceId);
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
