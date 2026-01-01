
import { Router } from 'express';
import { prisma } from '../db';
import { requireSession, requireWorkspace } from '../middleware/session_auth';
import { FeedbackService, FeedbackAction } from '../services/feedback.service';

const router = Router();

// Global Auth & Scoping
router.use(requireSession);
router.use(requireWorkspace);

// Edit Draft
router.post('/drafts/:id/edit', async (req, res) => {
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
router.post('/drafts/:id/approve', async (req, res) => {
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
router.post('/drafts/:id/reject', async (req, res) => {
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
router.post('/drafts/:id/mark-sent', async (req, res) => {
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

export const draftsRouter = router;
