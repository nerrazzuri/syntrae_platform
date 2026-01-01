
import { prisma } from '../index';

export enum FeedbackAction {
    DRAFT_APPROVED = 'DRAFT_APPROVED',
    DRAFT_EDITED = 'DRAFT_EDITED',
    DRAFT_REJECTED = 'DRAFT_REJECTED',
    MANUAL_SENT = 'MANUAL_SENT'
}

export class FeedbackService {
    static async logFeedback(
        draftId: string,
        action: FeedbackAction,
        userId: string,
        meta: any = {}
    ) {
        // Log to AuditLog for now (since FeedbackSignal is tied to Suggestions)
        // Phase 37.5 can introduce specialized tables if needed.
        // For MANUAL_SENT, we have ManualSendEvent (handled in Drafts Controller).

        await prisma.auditLog.create({
            data: {
                actor_id: userId,
                actor_type: 'USER',
                action: action,
                resource: 'OutreachDraft',
                resource_id: draftId,
                meta: JSON.stringify(meta)
            }
        });
    }

    static async recordManualSend(data: {
        draft_id: string;
        lead_id: string;
        brand_id: string;
        sent_text: string;
        sent_by_user_id: string;
        platform: string;
        send_mode: 'COPY_PASTE' | 'PLATFORM_UI' | 'OTHER';
        confirmation_ack: boolean;
        notes?: string;
    }) {
        return prisma.manualSendEvent.create({
            data: {
                draft_id: data.draft_id,
                lead_id: data.lead_id,
                brand_id: data.brand_id,
                sent_text: data.sent_text,
                sent_by_user_id: data.sent_by_user_id,
                platform: data.platform,
                send_mode: data.send_mode,
                confirmation_ack: data.confirmation_ack,
                notes: data.notes
            }
        });
    }
}
