import { Router, Request, Response } from 'express';
import { requireSession } from '../middleware/session_auth';
import { BrandService } from '../services/brand.service';
import { LeadService } from '../services/lead_service';
import { SubscriptionPolicyError } from '../services/billing/subscription_policy.service';

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
        if (err instanceof SubscriptionPolicyError) {
            res.status(403).json({ error: err.message, code: err.code, details: err.details });
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

// PATCH /brands/:id
router.patch('/:id', async (req: Request, res: Response) => {
    try {
        const brandId = req.params.id;
        const workspaceId = req.session?.active_workspace_id!;
        const updated = await BrandService.updateBrandBasics(workspaceId, brandId, {
            name: req.body?.name,
            domain: req.body?.domain,
        });
        res.json(updated);
    } catch (err: any) {
        console.warn('[Brands] Update Failed:', err.message);
        res.status(400).json({ error: err.message });
    }
});

// GET /brands/:brandId/leads (Phase 37.4)
router.get('/:brandId/leads', async (req: Request, res: Response) => {
    try {
        const { brandId } = req.params;
        const workspaceId = req.session?.active_workspace_id!;

        // Validation: Ensure Brand belongs to Workspace? 
        // LeadService.listLeads filters by accountId (Workspace) AND Brand.
        // So cross-access is prevented by accountId check.

        // Filters
        const filters: any = {
            brand_id: brandId,
            status: req.query.status,
            risk_level: req.query.risk_level,
            buyer_stage: req.query.buyer_stage,
        };
        if (req.query.min_score) filters.min_confidence = parseFloat(req.query.min_score as string);

        const result = await LeadService.listLeads(workspaceId, filters, 100, 0);
        res.json(result.items); // Return list directly as per plan implication
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// GET /brands/:brandId/leads/:leadId/drafts (Phase 37.4)
import { prisma } from '../db';
router.get('/:brandId/leads/:leadId/drafts', async (req: Request, res: Response) => {
    try {
        const { brandId, leadId } = req.params;
        const workspaceId = req.session?.active_workspace_id!;

        // Verify access implicitly via query
        const drafts = await prisma.outreachDraft.findMany({
            where: {
                lead_id: leadId,
                brand_id: brandId,
                account_id: workspaceId
            },
            orderBy: { created_at: 'desc' }
        });

        res.json(drafts);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

export const brandRouter = router;
