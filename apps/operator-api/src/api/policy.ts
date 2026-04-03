
import { Router } from 'express';
import { PolicyService } from '../services/policy.service';
import { requireAuth } from '../middleware/auth';
import { requireSession, requireWorkspace } from '../middleware/session_auth';

const router = Router();


// Access Control Wrapper
const getPolicyAccess = async (req: any, res: any, next: any) => {
    // 1. Check if Session exists (via shared logic or copy)
    const sessionId = req.cookies?.['syntrae_session'];
    if (sessionId) {
        // Ideally verify session... skipping full reimplementation for brevity, assuming standard flow uses requireAuth for everything else.
        // If we want to support UI, we need Session.
        // Let's use `requireAuth` for UI routes, and a separate route for Automation?
        // OR: Make `requireAuth` optional?

        // Strategy: Automation uses a different endpoint? 
        // GET /brands/:id/policy/agent ? 
        // No, Keep it clean.

        // Let's Try:
        return requireAuth(req, res, next);
    }

    // 2. Check Install ID for Automation
    const installId = req.headers['x-install-id'];
    if (installId) {
        req.installId = String(installId);
        return next();
    }

    console.warn(`[Policy] Unauthorized Access Attempt. User: ${req.user?.id}, Headers:`, JSON.stringify(req.headers));

    // Do NOT return requireAuth(req, res, next) here if failed, as it will look for session and fail.
    // Instead return 401 directly if neither matched.
    res.status(401).json({ error: "Unauthorized: No Session or Agent ID" });
};

router.get('/brands/:brandId/automation-policy', getPolicyAccess, async (req, res) => {
    const { brandId } = req.params;
    try {
        const workspaceId = req.session?.active_workspace_id || req.activeWorkspaceId;
        const installId = req.installId;
        const policy = await PolicyService.getPolicy(brandId, workspaceId, installId);
        res.json(policy);
    } catch (error: any) {
        const status = error.message?.includes('authorized') || error.message?.includes('access denied') || error.message?.includes('Brand not found') ? 404 : 500;
        res.status(status).json({ error: error.message || 'Failed to fetch policy' });
    }
});

// Update Policy (Create New Version)
router.put('/brands/:brandId/automation-policy', requireSession, requireWorkspace, async (req, res) => {
    const { brandId } = req.params;
    const updates = req.body;
    const userId = req.user?.id; // Assuming auth middleware populates this

    try {
        const policy = await PolicyService.updatePolicy(brandId, req.activeWorkspaceId!, updates, userId);
        res.json(policy);
    } catch (error: any) {
        const status = error.message?.includes('access denied') || error.message?.includes('Brand not found') ? 404 : 400;
        res.status(status).json({ error: error.message || 'Validation failed' });
    }
});

// Get Policy History
router.get('/brands/:brandId/automation-policy/history', requireSession, requireWorkspace, async (req, res) => {
    const { brandId } = req.params;
    try {
        const history = await PolicyService.getHistory(brandId, req.activeWorkspaceId!);
        res.json(history);
    } catch (error: any) {
        const status = error.message?.includes('access denied') || error.message?.includes('Brand not found') ? 404 : 500;
        res.status(status).json({ error: error.message || 'Failed to fetch history' });
    }
});

export const policyRouter = router;
