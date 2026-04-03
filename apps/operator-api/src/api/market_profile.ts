import { Router, Request, Response } from 'express';
import { requireSession, requireWorkspace } from '../middleware/session_auth';
import { MarketProfileService, CreateProfileDTO, UpdateProfileDTO } from '../services/market_profile.service';

const router = Router();

const requireAgentOrSession = async (req: any, res: any, next: any) => {
    // 1. Connector/Agent Auth (Internal Secret) - Check FIRST (Fast path)
    // Supports case-insensitive header check
    const internalSecret = req.headers['x-internal-secret'] || req.headers['x_internal_secret'];
    const expectedSecret = process.env.AI_CORE_INTERNAL_SECRET;

    if (internalSecret && expectedSecret && internalSecret === expectedSecret) {
        return next();
    }

    // 2. Session Auth (UI User)
    return requireSession(req, res, () => requireWorkspace(req, res, next));
};

// List Profiles for a Brand
router.get('/brands/:brandId/market-profiles', requireAgentOrSession, async (req: Request, res: Response) => {
    try {
        const profiles = await MarketProfileService.listProfiles(req.params.brandId, req.activeWorkspaceId);
        res.json(profiles);
    } catch (error: any) {
        const status = error.message?.includes('access denied') || error.message?.includes('Brand not found') ? 404 : 500;
        res.status(status).json({ error: error.message });
    }
});

// Create Profile
router.post('/brands/:brandId/market-profiles', requireSession, requireWorkspace, async (req: Request, res: Response) => {
    try {
        const profile = await MarketProfileService.createProfile(
            req.params.brandId,
            req.activeWorkspaceId!,
            req.body as CreateProfileDTO
        );
        res.status(201).json(profile);
    } catch (error: any) {
        const status = error.message?.includes('access denied') || error.message?.includes('Brand not found') ? 404 : 400;
        res.status(status).json({ error: error.message });
    }
});

// Update Profile
router.patch('/market-profiles/:id', requireSession, requireWorkspace, async (req: Request, res: Response) => {
    try {
        const profile = await MarketProfileService.updateProfile(
            req.params.id,
            req.activeWorkspaceId!,
            req.body as UpdateProfileDTO
        );
        res.json(profile);
    } catch (error: any) {
        const status = error.message?.includes('access denied') || error.message?.includes('not found') ? 404 : 400;
        res.status(status).json({ error: error.message });
    }
});

// Activate Profile (Shortcut)
router.post('/market-profiles/:id/activate', requireSession, requireWorkspace, async (req: Request, res: Response) => {
    try {
        const profile = await MarketProfileService.updateProfile(
            req.params.id,
            req.activeWorkspaceId!,
            { is_active: true }
        );
        res.json(profile);
    } catch (error: any) {
        const status = error.message?.includes('access denied') || error.message?.includes('not found') ? 404 : 400;
        res.status(status).json({ error: error.message });
    }
});

export default router;
