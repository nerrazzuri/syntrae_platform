
import { Router } from 'express';
import { prisma } from '../db';

const router = Router();

// Reusing the access logic from `policy.ts`? 
// For speed/DRY, we should export it or move to middleware.
// But duplication is safer for now to avoid breaking existing file imports blindly.
// Queue a Run (User Trigger)
// requireAgentAccess Middleware
const requireAgentAccess = async (req: any, res: any, next: any) => {
    // 1. Try Session Auth (User context) - Users probably don't create runs manually but maybe for testing.
    if (req.user) return next();

    // 2. Connector/Agent Auth
    const installId = req.headers['x-install-id'];
    const brandId = req.params.brandId;

    if (installId && brandId) {
        return next();
    }
    return res.status(401).json({ error: "Unauthorized Agent" });
};

// Queue a Run (User Trigger)
router.post('/brands/:brandId/runs/queue', async (req: any, res: any) => {
    // Basic User Session Auth (Session Middleware should be here)
    // For now assuming internal/open
    const { brandId } = req.params;
    console.log(`[API] Queueing run for brand ${brandId}`);
    const { platform = 'tiktok' } = req.body;

    try {
        const run = await prisma.automationRun.create({
            data: {
                brand_id: brandId,
                install_id: 'pending', // Will be claimed by agent
                platform: platform,
                status: 'PENDING',
                started_at: new Date(), // Queued Time
                policy_id: 'manual-trigger',
                policy_snapshot: {},
            }
        });
        res.json(run);
    } catch (e: any) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// List Pending Runs (For Agent Polling)
router.get('/brands/:brandId/runs/pending', requireAgentAccess, async (req: any, res: any) => {
    try {
        const run = await prisma.automationRun.findFirst({
            where: {
                brand_id: req.params.brandId,
                status: 'PENDING'
            },
            orderBy: { started_at: 'asc' }
        });
        res.json(run || null);
    } catch (e) {
        res.status(500).json({});
    }
});

// GLOBAL Pending Runs (For System Workers)
router.get('/runs/pending', async (req: any, res: any) => {
    // Should be secured by Admin/System Secret
    try {
        const run = await prisma.automationRun.findFirst({
            where: { status: 'PENDING' },
            orderBy: { started_at: 'asc' }
        });
        res.json(run || null);
    } catch (e) {
        res.status(500).json({});
    }
});

router.post('/brands/:brandId/automation-runs', requireAgentAccess, async (req, res) => {
    const { brandId } = req.params;
    const {
        install_id,
        platform,
        policy_id,
        policy_snapshot
    } = req.body;

    try {
        const run = await prisma.automationRun.create({
            data: {
                brand_id: brandId,
                install_id: install_id || req.headers['x-install-id'] || 'unknown',
                platform: platform || 'unknown',
                status: 'RUNNING',
                started_at: new Date(),
                policy_id: policy_id, // Links to specific policy version row
                policy_snapshot: policy_snapshot || {}, // The exact JSON used
                stats: {}
            }
        });

        res.json(run);
    } catch (error: any) {
        console.error("Run creation failed:", error);
        res.status(500).json({ error: "Failed to create run record" });
    }
});

// Update Run (Optional, for completion)
router.put('/brands/:brandId/automation-runs/:runId', requireAgentAccess, async (req, res) => {
    const { runId } = req.params;
    const { status, stats, abort_reason } = req.body;

    try {
        const run = await prisma.automationRun.update({
            where: { id: runId },
            data: {
                status: status,
                ended_at: (status === 'COMPLETED' || status === 'FAILED' || status === 'ABORTED') ? new Date() : undefined,
                stats: stats,
                abort_reason: abort_reason
            }
        });
        res.json(run);
    } catch (error) {
        res.status(500).json({ error: "Failed to update run" });
    }
});

export const runsRouter = router;
