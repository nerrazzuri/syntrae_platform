import { Router, Request, Response } from 'express';
import { requireSession, requireWorkspace } from '../middleware/session_auth';
import { PlatformConnectionService } from '../services/platform_connection.service';

const router = Router();

router.post('/platform-connections/:platform/ingest', async (req: Request, res: Response) => {
    try {
        const { challenge_id, nonce, cookies, user_agent } = req.body || {};
        const connection = await PlatformConnectionService.ingestCookies(
            req.params.platform,
            String(challenge_id || ''),
            String(nonce || ''),
            Array.isArray(cookies) ? cookies : [],
            typeof user_agent === 'string' ? user_agent : null
        );
        res.json(connection);
    } catch (error: any) {
        const message = String(error?.message || '');
        res.status(400).json({ error: message || 'Failed to ingest platform session' });
    }
});

router.use(requireSession);
router.use(requireWorkspace);

router.get('/brands/:brandId/platform-connections/:platform', async (req: Request, res: Response) => {
    try {
        const connection = await PlatformConnectionService.getConnection(
            req.activeWorkspaceId!,
            req.params.brandId,
            req.params.platform
        );
        res.json(connection);
    } catch (error: any) {
        const message = String(error?.message || '');
        const status = message.includes('access denied') || message.includes('Brand not found') ? 404 : 400;
        res.status(status).json({ error: message || 'Failed to load platform connection' });
    }
});

router.post('/brands/:brandId/platform-connections/:platform/request', async (req: Request, res: Response) => {
    try {
        const connection = await PlatformConnectionService.requestConnection(
            req.activeWorkspaceId!,
            req.params.brandId,
            req.params.platform
        );
        res.json(connection);
    } catch (error: any) {
        const message = String(error?.message || '');
        const status = message.includes('access denied') || message.includes('Brand not found') ? 404 : 400;
        res.status(status).json({ error: message || 'Failed to request platform connection' });
    }
});

router.post('/brands/:brandId/platform-connections/:platform/challenge', async (req: Request, res: Response) => {
    try {
        const challenge = await PlatformConnectionService.createChallenge(
            req.activeWorkspaceId!,
            req.params.brandId,
            req.params.platform,
            req.user!.id
        );
        res.json(challenge);
    } catch (error: any) {
        const message = String(error?.message || '');
        const status = message.includes('access denied') || message.includes('Brand not found') ? 404 : 400;
        res.status(status).json({ error: message || 'Failed to create connection challenge' });
    }
});

router.post('/brands/:brandId/platform-connections/:platform/refresh', async (req: Request, res: Response) => {
    try {
        const connection = await PlatformConnectionService.getConnection(
            req.activeWorkspaceId!,
            req.params.brandId,
            req.params.platform
        );
        res.json(connection);
    } catch (error: any) {
        const message = String(error?.message || '');
        const status = message.includes('access denied') || message.includes('Brand not found') ? 404 : 400;
        res.status(status).json({ error: message || 'Failed to refresh platform connection' });
    }
});

router.post('/brands/:brandId/platform-connections/:platform/verify', async (req: Request, res: Response) => {
    try {
        const connection = await PlatformConnectionService.verifyConnection(
            req.activeWorkspaceId!,
            req.params.brandId,
            req.params.platform
        );
        res.json(connection);
    } catch (error: any) {
        const message = String(error?.message || '');
        const status = message.includes('access denied') || message.includes('Brand not found') ? 404 : 400;
        res.status(status).json({ error: message || 'Failed to verify platform connection' });
    }
});

router.delete('/brands/:brandId/platform-connections/:platform', async (req: Request, res: Response) => {
    try {
        const connection = await PlatformConnectionService.disconnect(
            req.activeWorkspaceId!,
            req.params.brandId,
            req.params.platform
        );
        res.json(connection);
    } catch (error: any) {
        const message = String(error?.message || '');
        const status = message.includes('access denied') || message.includes('Brand not found') ? 404 : 400;
        res.status(status).json({ error: message || 'Failed to disconnect platform connection' });
    }
});

export const platformConnectionsRouter = router;
