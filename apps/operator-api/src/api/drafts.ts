
import { Router } from 'express';
import { prisma } from '../db';
import { requireSession, requireWorkspace } from '../middleware/session_auth';
import { FeedbackService, FeedbackAction } from '../services/feedback.service';

const router = Router();

function buildThreadUrl(platform: string, videoId?: string | null, metadata?: any): string | null {
    const pageUrl = typeof metadata?.page?.url === 'string'
        ? metadata.page.url
        : typeof metadata?.page_url === 'string'
            ? metadata.page_url
            : null;
    const videoUrl = typeof metadata?.video?.video_url === 'string'
        ? metadata.video.video_url
        : typeof metadata?.video_url === 'string'
            ? metadata.video_url
            : null;

    if (pageUrl) return pageUrl;
    if (videoUrl) return videoUrl;

    if (!videoId) return null;

    if (platform === 'rednote' || platform === 'xiaohongshu') {
        return `https://www.xiaohongshu.com/explore/${videoId}`;
    }

    return null;
}

// Global Auth & Scoping
router.use(requireSession);
router.use(requireWorkspace);

router.get('/', async (req, res) => {
    const accountId = req.activeWorkspaceId!;
    const statusFilter = String(req.query.status || 'PENDING').toUpperCase();
    const statuses = statusFilter === 'PENDING'
        ? ['DRAFT', 'EDITED', 'APPROVED']
        : statusFilter.split(',').map((value) => value.trim()).filter(Boolean);

    try {
        const drafts = await prisma.outreachDraft.findMany({
            where: {
                account_id: accountId,
                status: { in: statuses },
                draft_kind: 'PUBLIC_REPLY',
            },
            orderBy: { created_at: 'desc' },
            include: {
                lead: {
                    select: {
                        id: true,
                        intent: true,
                        buyer_stage: true,
                        confidence: true,
                        video_id: true,
                        comment_id: true,
                        user_handle: true,
                        user_profile_url: true,
                        platform: true,
                        event: {
                            select: {
                                content_text: true,
                                metadata: true,
                            }
                        }
                    }
                },
                brand: {
                    select: {
                        id: true,
                        name: true,
                    }
                }
            }
        });

        res.json(drafts.map((draft) => ({
            ...draft,
            original_comment: draft.lead?.event?.content_text || null,
            thread_reference: draft.lead ? {
                platform: draft.lead.platform,
                video_id: draft.lead.video_id,
                comment_id: draft.lead.comment_id,
                user_handle: draft.lead.user_handle || null,
                user_profile_url: draft.lead.user_profile_url || null,
                thread_url: buildThreadUrl(draft.lead.platform, draft.lead.video_id, draft.lead.event?.metadata),
            } : null,
        })));
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Edit Draft
router.post('/:id/edit', async (req, res) => {
    const { id } = req.params;
    const { edited_text } = req.body;
    const userId = req.session!.user_id;
    const accountId = req.activeWorkspaceId!;

    try {
        const draft = await prisma.outreachDraft.findUnique({ where: { id } });

        // 1. RBAC: Existence & Tenant Scope
        if (!draft || draft.account_id !== accountId) {
            return res.status(404).json({ error: "Draft not found" });
        }

        // 2. Strict State Machine: Allow transitions from DRAFT or APPROVED only
        // Cannot edit SENT or REJECTED
        if (draft.status !== 'DRAFT' && draft.status !== 'APPROVED') {
            return res.status(400).json({ error: `Cannot edit draft in status ${draft.status}` });
        }

        // Transition: DRAFT/APPROVED -> EDITED
        // Critical: If APPROVED, clear approval.
        const updateData: any = {
            status: 'EDITED',
            edited_text: edited_text,
            updated_at: new Date()
        };

        if (draft.status === 'APPROVED') {
            updateData.approved_by_user_id = null;
            updateData.approved_at = null;
        }

        const updated = await prisma.outreachDraft.update({
            where: { id },
            data: updateData
        });

        await FeedbackService.logFeedback(id, FeedbackAction.DRAFT_EDITED, userId, { previous_status: draft.status });
        res.json(updated);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Approve Draft
router.post('/:id/approve', async (req, res) => {
    const { id } = req.params;
    const userId = req.session!.user_id;
    const accountId = req.activeWorkspaceId!;

    try {
        const draft = await prisma.outreachDraft.findUnique({ where: { id } });

        // 1. RBAC
        if (!draft || draft.account_id !== accountId) {
            return res.status(404).json({ error: "Draft not found" });
        }

        // 2. Strict State Machine: Allow DRAFT or EDITED
        if (draft.status !== 'DRAFT' && draft.status !== 'EDITED') {
            return res.status(400).json({ error: `Cannot approve draft in status ${draft.status}` });
        }

        // Transition: DRAFT/EDITED -> APPROVED
        const updated = await prisma.outreachDraft.update({
            where: { id },
            data: {
                status: 'APPROVED',
                approved_by_user_id: userId,
                approved_at: new Date(),
                updated_at: new Date()
            }
        });

        await FeedbackService.logFeedback(id, FeedbackAction.DRAFT_APPROVED, userId);
        res.json(updated);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Reject Draft
router.post('/:id/reject', async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    const userId = req.session!.user_id;
    const accountId = req.activeWorkspaceId!;

    try {
        const draft = await prisma.outreachDraft.findUnique({ where: { id } });

        // 1. RBAC
        if (!draft || draft.account_id !== accountId) {
            return res.status(404).json({ error: "Draft not found" });
        }

        // 2. Immutability: Cannot reject a SENT draft.
        if (draft.status === 'SENT') {
            return res.status(400).json({ error: "Cannot reject a SENT draft" });
        }

        // Transition: * -> REJECTED (except SENT)
        const updated = await prisma.outreachDraft.update({
            where: { id },
            data: {
                status: 'REJECTED',
                updated_at: new Date()
            }
        });

        await FeedbackService.logFeedback(id, FeedbackAction.DRAFT_REJECTED, userId, { reason });
        res.json(updated);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Mark Sent
router.post('/:id/mark-sent', async (req, res) => {
    const { id } = req.params;
    const { send_mode, confirmation_ack, notes } = req.body;
    const userId = req.session!.user_id;
    const accountId = req.activeWorkspaceId!;

    try {
        const draft = await prisma.outreachDraft.findUnique({ where: { id } });

        // 1. RBAC
        if (!draft || draft.account_id !== accountId) {
            return res.status(404).json({ error: "Draft not found" });
        }

        // 2. Strict State Machine: Must be APPROVED
        if (draft.status !== 'APPROVED') {
            return res.status(400).json({ error: "Draft must be APPROVED before sending" });
        }

        if (!confirmation_ack) {
            return res.status(400).json({ error: "Confirmation acknowledgement required" });
        }

        // Determine final text (Immutable snapshot)
        // Since status is APPROVED, and edits clear approval, we trust edited_text if present, else draft_text.
        const finalText = draft.edited_text || draft.draft_text;

        // Transition: APPROVED -> SENT
        const updated = await prisma.$transaction(async (tx) => {
            // 1. Update Draft
            const d = await tx.outreachDraft.update({
                where: { id },
                data: {
                    status: 'SENT',
                    sent_at: new Date(),
                    updated_at: new Date()
                }
            });

            // 2. Create Liability Ledger
            await tx.manualSendEvent.create({
                data: {
                    draft_id: id,
                    lead_id: draft.lead_id,
                    brand_id: draft.brand_id, // Now populated correctly by LeadService
                    sent_text: finalText,
                    sent_by_user_id: userId,
                    platform: draft.platform,
                    send_mode: send_mode || 'OTHER',
                    confirmation_ack: true,
                    notes: notes
                }
            });

            return d;
        });

        await FeedbackService.logFeedback(id, FeedbackAction.MANUAL_SENT, userId);
        res.json(updated);

    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/:id/send', async (req, res) => {
    const { id } = req.params;
    const userId = req.session!.user_id;
    const accountId = req.activeWorkspaceId!;

    try {
        const draft = await prisma.outreachDraft.findUnique({
            where: { id },
            include: {
                lead: {
                    select: {
                        comment_id: true,
                        video_id: true,
                    }
                }
            }
        });

        if (!draft || draft.account_id !== accountId) {
            return res.status(404).json({ error: 'Draft not found' });
        }

        if (draft.status !== 'APPROVED') {
            return res.status(400).json({ error: 'Draft must be APPROVED before sending' });
        }

        if (draft.reply_channel !== 'THREAD_REPLY') {
            return res.status(400).json({ error: `Unsupported reply channel ${draft.reply_channel}` });
        }

        const finalText = draft.edited_text || draft.draft_text;
        const automationApiUrl = process.env.AUTOMATION_API_URL || 'http://video-detection-engine:8000';
        const internalSecret = process.env.AI_CORE_INTERNAL_SECRET;

        const response = await fetch(`${automationApiUrl}/api/v1/delivery/thread-reply`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-internal-secret': internalSecret || '',
            },
            body: JSON.stringify({
                platform: draft.platform,
                workspace_id: accountId,
                brand_id: draft.brand_id,
                video_id: draft.lead.video_id,
                comment_id: draft.lead.comment_id,
                message_text: finalText,
            })
        });

        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
            await prisma.outreachDraft.update({
                where: { id },
                data: {
                    delivery_error: payload?.detail || payload?.error || `HTTP ${response.status}`,
                    updated_at: new Date(),
                }
            });
            return res.status(response.status).json({
                error: payload?.detail || payload?.error || 'Failed to send thread reply',
                code: 'PLATFORM_DELIVERY_FAILED',
            });
        }

        const updated = await prisma.$transaction(async (tx) => {
            const nextDraft = await tx.outreachDraft.update({
                where: { id },
                data: {
                    status: 'SENT',
                    sent_at: new Date(),
                    delivery_error: null,
                    updated_at: new Date(),
                }
            });

            await tx.manualSendEvent.create({
                data: {
                    draft_id: id,
                    lead_id: draft.lead_id,
                    brand_id: draft.brand_id,
                    sent_text: finalText,
                    sent_by_user_id: userId,
                    platform: draft.platform,
                    send_mode: 'PLATFORM_API',
                    confirmation_ack: true,
                    notes: JSON.stringify(payload),
                }
            });

            return nextDraft;
        });

        await FeedbackService.logFeedback(id, FeedbackAction.MANUAL_SENT, userId, { automated_delivery: true });
        res.json({ draft: updated, delivery: payload });
    } catch (error: any) {
        res.status(500).json({ error: error.message || 'Failed to send reply' });
    }
});

export const draftsRouter = router;
