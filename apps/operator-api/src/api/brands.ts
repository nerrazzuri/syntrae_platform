import { Router, Request, Response } from 'express';
import { requireSession } from '../middleware/session_auth';
import { BrandService } from '../services/brand.service';
import { LeadService } from '../services/lead_service';
import { CatalogService } from '../services/catalog.service';
import { CatalogImportService } from '../services/catalog_import.service';
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

// GET /brands/:brandId/catalog
router.get('/:brandId/catalog', async (req: Request, res: Response) => {
    try {
        const workspaceId = req.session?.active_workspace_id;
        if (!workspaceId) {
            res.status(400).json({ error: 'No active workspace' });
            return;
        }

        const items = await CatalogService.listItems(workspaceId, req.params.brandId);
        res.json(items);
    } catch (err: any) {
        console.warn('[Brands] Catalog List Failed:', err.message);
        res.status(400).json({ error: err.message });
    }
});

// POST /brands/:brandId/catalog
router.post('/:brandId/catalog', async (req: Request, res: Response) => {
    try {
        const workspaceId = req.session?.active_workspace_id;
        if (!workspaceId) {
            res.status(400).json({ error: 'No active workspace' });
            return;
        }

        const item = await CatalogService.createItem(workspaceId, req.params.brandId, req.body || {});
        res.status(201).json(item);
    } catch (err: any) {
        console.warn('[Brands] Catalog Create Failed:', err.message);
        res.status(400).json({ error: err.message });
    }
});

// PATCH /brands/:brandId/catalog/:itemId
router.patch('/:brandId/catalog/:itemId', async (req: Request, res: Response) => {
    try {
        const workspaceId = req.session?.active_workspace_id;
        if (!workspaceId) {
            res.status(400).json({ error: 'No active workspace' });
            return;
        }

        const item = await CatalogService.updateItem(workspaceId, req.params.brandId, req.params.itemId, req.body || {});
        res.json(item);
    } catch (err: any) {
        console.warn('[Brands] Catalog Update Failed:', err.message);
        res.status(400).json({ error: err.message });
    }
});

// PATCH /brands/:brandId/catalog/:itemId/activate
router.patch('/:brandId/catalog/:itemId/activate', async (req: Request, res: Response) => {
    try {
        const workspaceId = req.session?.active_workspace_id;
        if (!workspaceId) {
            res.status(400).json({ error: 'No active workspace' });
            return;
        }

        const item = await CatalogService.activateItem(workspaceId, req.params.brandId, req.params.itemId);
        res.json(item);
    } catch (err: any) {
        console.warn('[Brands] Catalog Activate Failed:', err.message);
        res.status(400).json({ error: err.message });
    }
});

// GET /brands/:brandId/catalog/documents
router.get('/:brandId/catalog/documents', async (req: Request, res: Response) => {
    try {
        const workspaceId = req.session?.active_workspace_id;
        if (!workspaceId) {
            res.status(400).json({ error: 'No active workspace' });
            return;
        }

        const documents = await CatalogImportService.listDocuments(workspaceId, req.params.brandId);
        res.json(documents);
    } catch (err: any) {
        console.warn('[Brands] Catalog Documents List Failed:', err.message);
        res.status(400).json({ error: err.message });
    }
});

// POST /brands/:brandId/catalog/import
router.post('/:brandId/catalog/import', async (req: Request, res: Response) => {
    try {
        const workspaceId = req.session?.active_workspace_id;
        if (!workspaceId) {
            res.status(400).json({ error: 'No active workspace' });
            return;
        }
        const contentBase64 = typeof req.body?.content_base64 === 'string' ? req.body.content_base64 : '';
        const fileName = typeof req.body?.file_name === 'string' ? req.body.file_name : 'catalog-upload';
        const mimeType = typeof req.body?.mime_type === 'string' ? req.body.mime_type : 'application/octet-stream';
        if (!contentBase64) {
            res.status(400).json({ error: 'Import file is required' });
            return;
        }

        const result = await CatalogImportService.importDocument(workspaceId, req.params.brandId, {
            title: String(req.body?.title || fileName || 'Catalog Import'),
            sourceType: String(req.body?.source_type || 'FILE'),
            file: {
                buffer: Buffer.from(contentBase64, 'base64'),
                originalname: fileName,
                mimetype: mimeType,
                size: Number(req.body?.file_size_bytes || 0) || undefined,
            },
        });

        res.status(201).json(result);
    } catch (err: any) {
        console.warn('[Brands] Catalog Import Failed:', err.message);
        res.status(400).json({ error: err.message });
    }
});

// DELETE /brands/:brandId/catalog/documents/:documentId
router.delete('/:brandId/catalog/documents/:documentId', async (req: Request, res: Response) => {
    try {
        const workspaceId = req.session?.active_workspace_id;
        if (!workspaceId) {
            res.status(400).json({ error: 'No active workspace' });
            return;
        }

        const document = await CatalogImportService.archiveDocument(workspaceId, req.params.brandId, req.params.documentId);
        res.json({ status: 'ok', document });
    } catch (err: any) {
        console.warn('[Brands] Catalog Document Archive Failed:', err.message);
        res.status(400).json({ error: err.message });
    }
});

// DELETE /brands/:brandId/catalog/:itemId
router.delete('/:brandId/catalog/:itemId', async (req: Request, res: Response) => {
    try {
        const workspaceId = req.session?.active_workspace_id;
        if (!workspaceId) {
            res.status(400).json({ error: 'No active workspace' });
            return;
        }

        const item = await CatalogService.archiveItem(workspaceId, req.params.brandId, req.params.itemId);
        res.json({ status: 'ok', item });
    } catch (err: any) {
        console.warn('[Brands] Catalog Archive Failed:', err.message);
        res.status(400).json({ error: err.message });
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

// DELETE /brands/:id
router.delete('/:id', async (req: Request, res: Response) => {
    try {
        const brandId = req.params.id;
        const workspaceId = req.session?.active_workspace_id!;
        const deleted = await BrandService.deleteBrand(workspaceId, brandId);
        res.json({ status: 'ok', brand: deleted });
    } catch (err: any) {
        console.warn('[Brands] Delete Failed:', err.message);
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
