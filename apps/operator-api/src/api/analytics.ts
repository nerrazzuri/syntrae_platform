
import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { AnalyticsService } from '../services/analytics.service';

const router = Router();

// Helper to parse date range
const parseDateRange = (req: Request) => {
    const now = new Date();
    // Default: Last 30 days
    let to = now;
    let from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    if (req.query.from && typeof req.query.from === 'string') {
        const parsed = new Date(req.query.from);
        if (!isNaN(parsed.getTime())) from = parsed;
    }

    if (req.query.to && typeof req.query.to === 'string') {
        const parsed = new Date(req.query.to);
        if (!isNaN(parsed.getTime())) to = parsed;
    }

    return { from, to };
};

// GET /analytics/overview
router.get('/overview', requireAuth, async (req: Request, res: Response) => {
    try {
        const workspaceId = (req as any).session?.active_workspace_id;
        if (!workspaceId) {
            return res.status(400).json({ error: 'No active workspace selected' });
        }

        const range = parseDateRange(req);
        const data = await AnalyticsService.getOverviewStats(workspaceId, range);

        res.json(data);
    } catch (error: any) {
        console.error('Analytics Overview Error:', error);
        res.status(500).json({ error: 'Failed to fetch analytics overview' });
    }
});

// GET /analytics/brands
router.get('/brands', requireAuth, async (req: Request, res: Response) => {
    try {
        const workspaceId = (req as any).session?.active_workspace_id;
        if (!workspaceId) {
            return res.status(400).json({ error: 'No active workspace selected' });
        }

        const range = parseDateRange(req);
        const data = await AnalyticsService.getBrandListStats(workspaceId, range);

        res.json(data);
    } catch (error: any) {
        console.error('Analytics Brands Error:', error);
        res.status(500).json({ error: 'Failed to fetch brand analytics' });
    }
});

// GET /analytics/usage
router.get('/usage', requireAuth, async (req: Request, res: Response) => {
    try {
        const workspaceId = (req as any).session?.active_workspace_id;
        if (!workspaceId) {
            return res.status(400).json({ error: 'No active workspace selected' });
        }

        const data = await AnalyticsService.getUsageStats(workspaceId);

        res.json(data);
    } catch (error: any) {
        console.error('Analytics Usage Error:', error);
        res.status(500).json({ error: 'Failed to fetch usage stats' });
    }
});

export const analyticsRouter = router;
