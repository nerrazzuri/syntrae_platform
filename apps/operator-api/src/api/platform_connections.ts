import { Router, Request, Response } from 'express';
import { requireSession, requireWorkspace } from '../middleware/session_auth';
import { PlatformConnectionService } from '../services/platform_connection.service';

const router = Router();

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
