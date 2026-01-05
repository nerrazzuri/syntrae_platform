import { Router, Request, Response } from 'express';
import { requireSession } from '../middleware/session_auth';
import { MarketProfileService, CreateProfileDTO, UpdateProfileDTO } from '../services/market_profile.service';
import { prisma } from '../db'; // Direct prisma access for simple checks if needed

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
    // Delegate to the standard session middleware which populates req.session and req.user
    // If this fails (no session), it sends 401, which is correct for UI access without login
    return requireSession(req, res, next);
};

// List Profiles for a Brand
router.get('/brands/:brandId/market-profiles', requireAgentOrSession, async (req: Request, res: Response) => {
    try {
        const profiles = await MarketProfileService.listProfiles(req.params.brandId);
        res.json(profiles);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Create Profile
router.post('/brands/:brandId/market-profiles', requireSession, async (req: Request, res: Response) => {
    try {
        const profile = await MarketProfileService.createProfile(req.params.brandId, req.body as CreateProfileDTO);
        res.status(201).json(profile);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

// Update Profile
router.patch('/market-profiles/:id', requireSession, async (req: Request, res: Response) => {
    try {
        const profile = await MarketProfileService.updateProfile(req.params.id, req.body as UpdateProfileDTO);
        res.json(profile);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

// Activate Profile (Shortcut)
router.post('/market-profiles/:id/activate', requireSession, async (req: Request, res: Response) => {
    try {
        const profile = await MarketProfileService.updateProfile(req.params.id, { is_active: true });
        res.json(profile);
    } catch (error: any) {
        res.status(400).json({ error: error.message });
    }
});

export default router;
