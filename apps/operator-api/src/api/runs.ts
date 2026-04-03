
import { Router } from 'express';
import { prisma } from '../db';
import { requireInternalSecret } from "../middleware/internal_auth";
import { requireSession } from '../middleware/session_auth';


const router = Router();

async function findConflictingRun(brandId: string, platform: string) {
    const now = new Date();
    const legacyCutoff = new Date(now.getTime() - 10 * 60 * 1000);

    return prisma.automationRun.findFirst({
        where: {
            brand_id: brandId,
            platform,
            OR: [
                { status: 'PENDING' },
                {
                    status: 'RUNNING',
                    OR: [
                        { lease_expires_at: { gt: now } },
                        {
                            lease_expires_at: null,
                            started_at: { gt: legacyCutoff }
                        }
                    ]
                }
            ]
        },
        orderBy: { started_at: 'desc' },
        select: {
            id: true,
            status: true,
            started_at: true,
            claimed_by: true,
            lease_expires_at: true
        }
    });
}

function normalizeRunStats(stats: any) {
    if (!stats || typeof stats !== 'object') return {};
    return stats as Record<string, any>;
}

function deriveWorkerHealth(run: any): string {
    if (run.status !== 'RUNNING') {
        if (run.status === 'PENDING' && run.next_retry_at) return 'RETRY_PENDING';
        return 'IDLE';
    }

    const now = Date.now();
    const leaseExpiresAt = run.lease_expires_at ? new Date(run.lease_expires_at).getTime() : null;
    const heartbeatAt = run.heartbeat_at ? new Date(run.heartbeat_at).getTime() : null;

    if (leaseExpiresAt && leaseExpiresAt <= now) return 'LEASE_STALE';
    if (heartbeatAt && now - heartbeatAt > 90_000) return 'HEARTBEAT_LATE';
    if (run.claimed_by) return 'ACTIVE';
    return 'UNCLAIMED_RUNNING';
}

// Apply session auth for UI endpoints (GET /runs)
// Apply session auth for UI endpoints (GET /runs)
// router.use('/runs', requireSession); // REMOVED: Blocks /runs/pending used by agents

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
    const { platform = 'tiktok' } = req.body;
    console.log(`[API] Queueing run for brand ${brandId}`, {
        platform,
        body: req.body
    });

    try {
        const conflictingRun = await findConflictingRun(brandId, platform);
        if (conflictingRun) {
            return res.status(409).json({
                error: 'RUN_ALREADY_ACTIVE',
                existing_run_id: conflictingRun.id,
                existing_status: conflictingRun.status
            });
        }

        const run = await prisma.automationRun.create({
            data: {
                brand_id: brandId,
                install_id: 'pending', // Will be claimed by agent
                platform: platform,
                status: 'PENDING',
                started_at: new Date(), // Queued Time
                // policy_id is now optional
                policy_snapshot: {},
            }
        });
        console.log(`[API] Run queued successfully: ${run.id}`);
        res.json(run);
    } catch (e: any) {
        console.error(`[API] Failed to queue run for brand ${brandId}:`, e);
        res.status(500).json({ error: e.message });
    }
});

// List Pending Runs (For Agent Polling)
router.get('/brands/:brandId/runs/pending', requireAgentAccess, async (req: any, res: any) => {
    return res.status(410).json({
        error: 'Deprecated endpoint. Use POST /internal/automation-runs/claim instead.'
    });
});

// GLOBAL Pending Runs (For System Workers)
router.get('/runs/pending', async (req: any, res: any) => {
    return res.status(410).json({
        error: 'Deprecated endpoint. Use POST /internal/automation-runs/claim instead.'
    });
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
        const conflictingRun = await findConflictingRun(brandId, platform || 'unknown');
        if (conflictingRun) {
            return res.status(409).json({
                error: 'RUN_ALREADY_ACTIVE',
                existing_run_id: conflictingRun.id,
                existing_status: conflictingRun.status
            });
        }

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

// Persist Discovered Video (Audit Trail) — WF-3.1 hardened
router.post('/runs/:runId/discovery', requireInternalSecret, async (req: any, res: any) => {
    const { runId } = req.params;

    const run = await prisma.automationRun.findUnique({
        where: { id: runId },
    });

    if (!run) {
        return res.status(404).json({ error: "AutomationRun not found" });
    }

    const { decision } = req.body;

    try {
        // -----------------------------
        // SYSTEM FAILURE PATH (WF-3.1)
        // -----------------------------
        if (decision === "ERROR") {
            const discovered = await prisma.discoveredVideo.create({
                data: {
                    automation_run_id: runId,
                    brand_id: run.brand_id,
                    platform: run.platform ?? "SYSTEM",
                    video_id: "SYSTEM",
                    video_url: "SYSTEM",
                    decision: "ERROR",
                    decision_reasons: req.body.reasons || [],
                    evaluation_performed: false,
                    error_class: req.body.error_class,
                    http_status: req.body.http_status,
                    // market_score intentionally omitted; DB default (0.0) is ignored when evaluation_performed=false
                    // market_profile_id / market_profile_version intentionally omitted (no fake provenance)
                }
            });

            return res.status(200).json(discovered);
        }

        // --------------------------------
        // BUSINESS DECISION PATH
        // --------------------------------
        const {
            brand_id,
            platform,
            video_id,
            video_url,
            market_score,
            reasons,
            market_profile_id,
            market_profile_version
        } = req.body;

        const discovered = await prisma.discoveredVideo.create({
            data: {
                automation_run_id: runId,
                brand_id,
                platform,
                video_id,
                video_url,
                market_score,
                decision_reasons: reasons || [],
                decision,
                market_profile_id,
                market_profile_version,
                evaluation_performed: true,
            }
        });

        return res.json(discovered);

    } catch (error: any) {
        console.error("Discovery persistence failed:", error);
        return res.status(500).json({ error: error.message });
    }
});


// GET /runs - List all runs (for Operator UI visibility)
// PILOT FIX: Secure with session auth and filter by workspace
router.get('/runs', requireSession, async (req: any, res: any) => {
    try {
        // Require session (user must be logged in)
        if (!req.user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;

        // FIX: Session stores active_workspace_id (which is the account id)
        const workspaceId = req.session?.active_workspace_id;

        if (!workspaceId) {
            return res.status(400).json({ error: 'No active workspace' });
        }

        const account = await prisma.account.findUnique({
            where: { id: workspaceId },
            include: {
                brands: {
                    select: { id: true }
                }
            }
        });

        if (!account) {
            return res.status(404).json({ error: 'Account not found' });
        }

        const brandIds = account.brands.map((b: any) => b.id);

        const runs = await prisma.automationRun.findMany({
            where: {
                brand_id: { in: brandIds }  // Only show runs for workspace brands
            },
            orderBy: { started_at: 'desc' },
            take: limit,
            skip: offset,
            include: {
                policy: {
                    select: {
                        id: true,
                        brand_id: true
                    }
                }
            }
        });

        // Join brand names
        const brandsMap = await prisma.brand.findMany({
            where: { id: { in: brandIds } },
            select: { id: true, name: true }
        });
        const brandNameMap = Object.fromEntries(brandsMap.map(b => [b.id, b.name]));

        const runsWithBrandNames = runs.map(run => ({
            ...run,
            brand_name: brandNameMap[run.brand_id] || 'Unknown',
            stats: normalizeRunStats(run.stats),
            worker_health: deriveWorkerHealth(run)
        }));

        const total = await prisma.automationRun.count({
            where: { brand_id: { in: brandIds } }
        });

        const health = {
            active_workers: new Set(
                runsWithBrandNames
                    .filter((run: any) => run.worker_health === 'ACTIVE' && run.claimed_by)
                    .map((run: any) => run.claimed_by)
            ).size,
            running_runs: runsWithBrandNames.filter((run: any) => run.status === 'RUNNING').length,
            stale_runs: runsWithBrandNames.filter((run: any) => run.worker_health === 'LEASE_STALE').length,
            retry_pending_runs: runsWithBrandNames.filter((run: any) => run.worker_health === 'RETRY_PENDING').length,
            duplicate_suppressed: runsWithBrandNames.reduce((sum: number, run: any) => sum + Number(run.stats?.duplicate_suppressed || 0), 0),
            cooldown_skipped: runsWithBrandNames.reduce((sum: number, run: any) => sum + Number(run.stats?.video_cooldown_suppressed || 0) + Number(run.stats?.videos_skipped_cooldown || 0), 0),
            stale_retries: runsWithBrandNames.reduce((sum: number, run: any) => sum + Math.max(Number(run.attempt_count || 0) - 1, 0), 0)
        };

        res.json({ runs: runsWithBrandNames, total, limit, offset, health });
    } catch (e: any) {
        console.error('[Runs] List Error:', e);
        res.status(500).json({ error: 'Failed to fetch runs' });
    }
});

export const runsRouter = router;
