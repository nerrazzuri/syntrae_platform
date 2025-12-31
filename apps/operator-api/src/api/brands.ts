import { Router, Request, Response } from 'express';
import { requireSession } from '../middleware/session_auth';
import { BrandService } from '../services/brand.service';

const router = Router();

router.use(requireSession);

// GET /brands
router.get('/', async (req: Request, res: Response) => {
    try {
        const workspaceId = req.session?.active_workspace_id;
        if (!workspaceId) {
            res.status(400).json({ error: 'No active workspace' });
            return;
        }
        const brands = await BrandService.listBrands(workspaceId);
        res.json(brands);
    } catch (err) {
        console.error('[Brands] List Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// POST /brands
router.post('/', async (req: Request, res: Response) => {
    try {
        const { name, domain } = req.body;
        const workspaceId = req.session?.active_workspace_id;

        if (!workspaceId || !name || !domain) {
            res.status(400).json({ error: 'Missing required fields' });
            return;
        }

        const brand = await BrandService.createBrand(workspaceId, name, domain);
        res.status(201).json(brand);
    } catch (err: any) {
        console.error('[Brands] Create Error:', err);
        if (err.message.includes('Plan limit')) {
            res.status(403).json({ error: err.message, code: 'PLAN_LIMIT_EXCEEDED' });
        } else {
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }
});

// PATCH /brands/:id/status
router.patch('/:id/status', async (req: Request, res: Response) => {
    try {
        const { status } = req.body;
        const brandId = req.params.id;
        const workspaceId = req.session?.active_workspace_id!;

        if (!['ACTIVE', 'PAUSED'].includes(status)) {
            res.status(400).json({ error: 'Invalid status' });
            return;
        }

        const updated = await BrandService.setBrandStatus(workspaceId, brandId, status);
        res.json(updated);
    } catch (err: any) {
        console.warn('[Brands] Status Update Failed:', err.message);
        res.status(400).json({ error: err.message });
    }
});

export const brandRouter = router;
