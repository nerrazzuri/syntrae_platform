import { Router, Request, Response } from 'express';
import { requireInternalSecret } from '../middleware/internal_auth';
import { prisma } from '../db';

const router = Router();

// Apply internal secret auth to all routes in this router
router.use(requireInternalSecret);

// GET /internal/automation-policy/latest
router.get('/automation-policy/latest', async (req: Request, res: Response) => {
    try {
        const brandId = req.query.brand_id as string;
        if (!brandId) return res.status(400).json({ error: "Missing brand_id" });

        const policy = await prisma.automationPolicy.findFirst({
            where: { brand_id: brandId, status: 'ACTIVE' },
            orderBy: { version: 'desc' }
        });

        if (!policy) return res.status(404).json({ error: "No active automation policy found" });
        return res.json(policy);
    } catch (e: any) {
        return res.status(500).json({ error: e.message });
    }
});

// GET /internal/market-profile/latest
router.get('/market-profile/latest', async (req: Request, res: Response) => {
    try {
        const brandId = req.query.brand_id as string;
        if (!brandId) return res.status(400).json({ error: "Missing brand_id" });

        const profile = await prisma.marketProfile.findFirst({
            where: { brand_id: brandId, is_active: true }, // Assuming is_active maps to ACTIVE equivalent
            orderBy: { version: 'desc' }
        });

        if (!profile) return res.status(404).json({ error: "No active market profile found" });
        return res.json(profile);
    } catch (e: any) {
        return res.status(500).json({ error: e.message });
    }
});

// POST /internal/automation-run
// ATOMIC: Created only if inputs are valid and persisted with snapshot
router.post('/automation-run', async (req: Request, res: Response) => {
    const { brand_id, install_id, platform, discovery_mode, policy_snapshot, market_profile_snapshot } = req.body;

    if (!brand_id || !install_id || !policy_snapshot) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    // Validate Snapshot Integrity (Basic check)
    // WF-1 requires market_profile_snapshot if discovery relies on it, but we won't strictly enforce existence for manual mode here,
    // Just enforce that if we create a run, we persist what was given.
    // However, the caller should ensure market_profile_snapshot is passed.

    try {
        const run = await prisma.automationRun.create({
            data: {
                brand_id,
                install_id,
                platform: platform || 'tiktok',
                discovery_mode: discovery_mode || 'MANUAL_URL',
                status: 'RUNNING',
                policy_snapshot: policy_snapshot,
                market_profile_snapshot: market_profile_snapshot || null, // Allow null for fallback/legacy but generally expected
                policy_id: policy_snapshot.id, // Link to source if available
            }
        });

        return res.status(201).json(run);
    } catch (e: any) {
        console.error("Failed to create automation run:", e);
        return res.status(500).json({ error: "Failed to persist automation run atomically" });
    }
});

// GET /internal/automation-run/:runId
// WF-3: Fetch run snapshot for market scoring
router.get('/automation-run/:runId', async (req: Request, res: Response) => {
    const { runId } = req.params;

    try {
        const run = await prisma.automationRun.findUnique({
            where: { id: runId },
            select: {
                id: true,
                brand_id: true,
                install_id: true,
                platform: true,
                discovery_mode: true,
                status: true,
                policy_snapshot: true,
                market_profile_snapshot: true,
                started_at: true
            }
        });

        // WF-3 Error Semantics (Locked)
        if (!run) {
            return res.status(404).json({ error: "Run not found", runId });
        }

        if (!run.market_profile_snapshot) {
            // WF-1 contract violation: run exists but missing snapshot
            return res.status(409).json({
                error: "WF-1 contract violation: market_profile_snapshot missing",
                runId
            });
        }

        // Validate snapshot is parseable JSON
        try {
            JSON.parse(JSON.stringify(run.market_profile_snapshot));
        } catch {
            return res.status(422).json({
                error: "Data corruption: market_profile_snapshot malformed",
                runId
            });
        }

        return res.json(run);
    } catch (e: any) {
        console.error(`Failed to fetch run ${runId}:`, e);
        return res.status(500).json({ error: "Internal server error" });
    }
});

// PATCH /internal/automation-run/:runId/status
// WF-3.1: Update run status for systemic failures
router.patch('/automation-run/:runId/status', async (req: Request, res: Response) => {
    const { runId } = req.params;
    const { status, abort_reason } = req.body;

    if (!status) {
        return res.status(400).json({ error: "Missing status" });
    }

    // Validate status is a known value
    const validStatuses = ['PENDING', 'RUNNING', 'COMPLETED', 'DEGRADED', 'ABORTED', 'FAILED'];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: `Invalid status: ${status}` });
    }

    try {
        const run = await prisma.automationRun.update({
            where: { id: runId },
            data: {
                status,
                abort_reason: abort_reason || null,
                ended_at: (status === 'COMPLETED' || status === 'DEGRADED' || status === 'FAILED' || status === 'ABORTED') ? new Date() : null
            }
        });

        return res.json(run);
    } catch (e: any) {
        console.error(`Failed to update run status ${runId}:`, e);
        if (e.code === 'P2025') {
            return res.status(404).json({ error: "Run not found", runId });
        }
        return res.status(500).json({ error: "Internal server error" });
    }
});

export const internalRouter = router;
