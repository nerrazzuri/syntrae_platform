import { Router, Request, Response } from 'express';
import { requireSession, requireWorkspace } from '../middleware/session_auth';
import { prisma } from '../db';

const router = Router();

router.use(requireSession);
router.use(requireWorkspace);

router.get('/status', async (req: Request, res: Response) => {
    try {
        const workspaceId = req.activeWorkspaceId!;
        const [workspace, brands, ownerSettings] = await Promise.all([
            prisma.account.findUnique({
                where: { id: workspaceId },
                select: { id: true, name: true, onboarding_state: true, plan_id: true, status: true },
            }),
            prisma.brand.findMany({
                where: { workspace_id: workspaceId },
                orderBy: { created_at: 'asc' },
                select: { id: true, name: true, domain: true, status: true },
            }),
            prisma.ownerSettings.findUnique({
                where: { workspace_id: workspaceId },
            }),
        ]);

        if (!workspace) {
            res.status(404).json({ error: 'Workspace not found' });
            return;
        }

        const primaryBrand = brands[0] || null;
        const activeMarketProfile = primaryBrand
            ? await prisma.marketProfile.findFirst({
                where: { brand_id: primaryBrand.id, status: { in: ['READY', 'ACTIVE'] } },
                orderBy: [{ is_active: 'desc' }, { updated_at: 'desc' }],
                select: { id: true, name: true, status: true, is_active: true },
            })
            : null;

        const platformsEnabled = safeParseStringArray(ownerSettings?.platforms_enabled);
        const checklist = {
            brand_basics: Boolean(primaryBrand?.name && primaryBrand?.domain && primaryBrand.domain !== 'general'),
            platform_selection: platformsEnabled.length > 0,
            market_profile: Boolean(activeMarketProfile),
        };

        res.json({
            workspace,
            primary_brand: primaryBrand,
            owner_settings: ownerSettings,
            active_market_profile: activeMarketProfile,
            checklist,
            is_complete: Object.values(checklist).every(Boolean),
        });
    } catch (error) {
        console.error('[Onboarding] Status Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

router.post('/complete', async (req: Request, res: Response) => {
    try {
        const workspaceId = req.activeWorkspaceId!;

        const brands = await prisma.brand.findMany({
            where: { workspace_id: workspaceId, status: 'ACTIVE' },
            orderBy: { created_at: 'asc' },
            select: { id: true, name: true, domain: true },
        });
        const primaryBrand = brands[0];
        const ownerSettings = await prisma.ownerSettings.findUnique({
            where: { workspace_id: workspaceId },
        });
        const platformsEnabled = safeParseStringArray(ownerSettings?.platforms_enabled);
        const activeMarketProfile = primaryBrand
            ? await prisma.marketProfile.findFirst({
                where: { brand_id: primaryBrand.id, status: { in: ['READY', 'ACTIVE'] } },
                select: { id: true },
            })
            : null;

        if (!primaryBrand || !primaryBrand.name || !primaryBrand.domain || primaryBrand.domain === 'general') {
            res.status(400).json({ error: 'Complete brand basics before finishing onboarding' });
            return;
        }
        if (platformsEnabled.length === 0) {
            res.status(400).json({ error: 'Select at least one platform before finishing onboarding' });
            return;
        }
        if (!activeMarketProfile) {
            res.status(400).json({ error: 'Create a market profile before finishing onboarding' });
            return;
        }

        await prisma.account.update({
            where: { id: workspaceId },
            data: { onboarding_state: 'ONBOARDED' },
        });

        res.json({ status: 'ok', onboarding_state: 'ONBOARDED' });
    } catch (error) {
        console.error('[Onboarding] Complete Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

export const onboardingRouter = router;

function safeParseStringArray(value?: string | null) {
    if (!value) return [] as string[];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
        return [];
    }
}
