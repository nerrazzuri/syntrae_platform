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

export const internalRouter = router;
