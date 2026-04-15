
import { prisma } from '../../db';
import { Suggestion, Prisma } from '@syntrae/prisma-schema';
import { buildThreadReference } from '../../utils/thread_reference';

export enum SuggestionStatus {
    PENDING = 'PENDING',
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED',
    EDITED = 'EDITED',
    EXPIRED = 'EXPIRED',
    RESOLVED = 'RESOLVED' // New for Manual Post
}

export class SuggestionService {

    /**
     * List suggestions for a workspace.
     */
    static async listSuggestions(workspaceId: string, status?: string, limit: number = 25, offset: number = 0) {
        const where: Prisma.SuggestionWhereInput = {
            workspace_id: workspaceId
        };
        if (status) {
            where.status = status;
        }

        const safeLimit = Math.min(Math.max(limit, 1), 100);
        const safeOffset = Math.max(offset, 0);

        const [total, suggestions] = await Promise.all([
            prisma.suggestion.count({ where }),
            prisma.suggestion.findMany({
                where,
                orderBy: { created_at: 'desc' },
                take: safeLimit,
                skip: safeOffset,
                include: { event: true }
            })
        ]);

        const items = suggestions.map((suggestion: any) => ({
            ...suggestion,
            original_comment: suggestion.event?.content_text || null,
            thread_reference: buildThreadReference({
                platform: suggestion.platform,
                videoId: suggestion.video_id,
                commentId: suggestion.comment_id,
                metadata: suggestion.event?.metadata,
            })
        })) as any;

        return {
            items,
            total,
            limit: safeLimit,
            offset: safeOffset,
        };
    }

    /**
     * Get details with Explainability.
     */
    static async getSuggestionDetail(workspaceId: string, suggestionId: string) {
        const suggestion = await prisma.suggestion.findUnique({
            where: { id: suggestionId },
            include: { event: true }
        });

        if (!suggestion || suggestion.workspace_id !== workspaceId) {
            throw new Error('Suggestion not found or access denied');
        }

        // Construct Explainability
        const explanation = await this.generateExplainability(suggestion);

        return {
            ...suggestion,
            original_comment: suggestion.event?.content_text || null,
            thread_reference: buildThreadReference({
                platform: suggestion.platform,
                videoId: suggestion.video_id,
                commentId: suggestion.comment_id,
                metadata: suggestion.event?.metadata,
            }),
            explanation
        };
    }

    private static async generateExplainability(suggestion: Suggestion) {
        // Simple reconstruction for Operator UI
        // In real system, this might be more complex parsing of signals
        const signals = JSON.parse(suggestion.signals || '{}');
        const settings = JSON.parse(suggestion.owner_settings_snapshot || '{}');

        return {
            detected_intent: signals.intent || 'Unknown',
            confidence_score: suggestion.confidence,
            owner_settings_applied: {
                mode: settings.mode,
            },
            summary: `Generated with ${suggestion.confidence.toFixed(2)} confidence.`
        };
    }

    /**
     * Mark suggestion as Manually Posted.
     */
    static async markAsPosted(workspaceId: string, userId: string, suggestionId: string, note?: string) {
        // Enforce Workspace Scoping: Find by ID AND WorkspaceID
        const suggestion = await prisma.suggestion.findFirst({
            where: {
                id: suggestionId,
                workspace_id: workspaceId
            }
        });

        if (!suggestion) throw new Error('Not found');

        // Enforce Invariant: One Decision Only
        if (suggestion.status !== SuggestionStatus.PENDING) {
            throw new Error(`Suggestion is already ${suggestion.status}. Cannot change decision.`);
        }

        const updated = await prisma.suggestion.update({
            where: { id: suggestionId },
            data: { status: SuggestionStatus.RESOLVED }
        });

        await prisma.suggestionDecision.create({
            data: {
                suggestion_id: suggestionId,
                workspace_id: workspaceId,
                user_id: userId,
                decision: 'POSTED_MANUALLY',
                reason: note
            }
        });

        return updated;
    }

    /**
     * Reject a suggestion.
     */
    static async rejectSuggestion(workspaceId: string, userId: string, suggestionId: string, reason?: string) {
        // Enforce Workspace Scoping
        const suggestion = await prisma.suggestion.findFirst({
            where: {
                id: suggestionId,
                workspace_id: workspaceId
            }
        });

        if (!suggestion) throw new Error('Not found');

        // Enforce Invariant: One Decision Only
        if (suggestion.status !== SuggestionStatus.PENDING) {
            throw new Error(`Suggestion is already ${suggestion.status}. Cannot change decision.`);
        }

        const updated = await prisma.suggestion.update({
            where: { id: suggestionId },
            data: { status: SuggestionStatus.REJECTED }
        });

        await prisma.suggestionDecision.create({
            data: {
                suggestion_id: suggestionId,
                workspace_id: workspaceId,
                user_id: userId,
                decision: 'REJECT',
                reason: reason
            }
        });

        return updated;
    }
}
