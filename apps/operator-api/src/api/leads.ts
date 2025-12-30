import { Router, Request, Response } from 'express';
import { requireSession, requireWorkspace } from '../middleware/session_auth';
import { LeadService, LeadFilters } from '../services/lead_service';

const router = Router();

// Global Auth & Workspace Requirement
router.use(requireSession);
router.use(requireWorkspace);

// GET / - List Leads
router.get('/', async (req: Request, res: Response) => {
    try {
        const accountId = req.activeWorkspaceId!;

        // Parse filters
        const filters: LeadFilters = {
            buyer_stage: req.query.buyer_stage as any,
            recommended_action: req.query.recommended_action as any,
            platform: req.query.platform as string,
            created_after: req.query.created_after as string,
            created_before: req.query.created_before as string,
        };

        if (req.query.min_confidence) {
            filters.min_confidence = parseFloat(req.query.min_confidence as string);
        }

        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;

        const result = await LeadService.listLeads(accountId, filters, limit, offset);
        res.json(result);

    } catch (err) {
        console.error('[Leads] List Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// GET /export - Export CSV
router.get('/export', async (req: Request, res: Response) => {
    try {
        const accountId = req.activeWorkspaceId!;
        const filters: LeadFilters = {
            buyer_stage: req.query.buyer_stage as any,
            recommended_action: req.query.recommended_action as any,
            platform: req.query.platform as string,
        };
        if (req.query.min_confidence) {
            filters.min_confidence = parseFloat(req.query.min_confidence as string);
        }

        const leads = await LeadService.exportLeads(accountId, filters);

        // Manual CSV format
        // Columns: platform, buyer_stage, intent, confidence, recommended_action, urgency_score, user_handle, video_id, comment_id, created_at
        const headers = [
            'platform',
            'buyer_stage',
            'intent',
            'confidence',
            'recommended_action',
            'urgency_score',
            'user_handle',
            'user_profile_url',
            'video_id',
            'comment_id',
            'created_at'
        ];

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="leads_${accountId}_${Date.now()}.csv"`);

        // Write Header
        res.write(headers.join(',') + '\n');

        // Stream Rows
        for (const lead of leads) {
            const row = [
                lead.platform,
                lead.buyer_stage,
                lead.intent,
                lead.confidence.toFixed(2),
                lead.recommended_action,
                lead.urgency_score.toFixed(2),
                `"${(lead.user_handle || '').replace(/"/g, '""')}"`, // Escape quotes
                lead.user_profile_url || '',
                lead.video_id,
                lead.comment_id,
                lead.created_at.toISOString()
            ];
            res.write(row.join(',') + '\n');
        }

        res.end();

    } catch (err) {
        console.error('[Leads] Export Error:', err);
        // Do not return json if headers already sent, just end
        if (!res.headersSent) {
            res.status(500).json({ error: 'Export failed' });
        } else {
            res.end();
        }
    }
});

// GET /:id - Detail
router.get('/:id', async (req: Request, res: Response) => {
    try {
        const accountId = req.activeWorkspaceId!;
        const leadId = req.params.id;

        const lead = await LeadService.getLead(accountId, leadId);

        if (!lead) {
            res.status(404).json({ error: 'Lead not found' });
            return;
        }

        res.json(lead);
    } catch (err) {
        console.error('[Leads] Get Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


// POST /:id/draft - Generate Draft
router.post('/:id/draft', async (req: Request, res: Response) => {
    try {
        const accountId = req.activeWorkspaceId!;
        const leadId = req.params.id;
        const force = req.query.force === 'true';

        // @ts-ignore
        const draft = await LeadService.requestDraft(accountId, leadId, force);
        res.status(201).json(draft);
    } catch (err: any) {
        console.error('[Leads] Draft Error:', err);
        if (err.message.includes('not found')) {
            res.status(404).json({ error: 'Lead not found or access denied' });
        } else {
            res.status(500).json({ error: 'Failed to generate draft: ' + err.message });
        }
    }
});

export const leadsRouter = router;
