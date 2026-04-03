import * as crypto from 'crypto';
import { prisma } from '../../db';
import { OwnerSettingsService } from '../owner/owner_settings_service';

export type DuplicateSuppression = {
    existingEventId: string;
    reason: 'SEMANTIC_COMMENT_DUPLICATE' | 'VIDEO_COOLDOWN_ACTIVE';
    ingestStatus: 'DUPLICATE_SUPPRESSED' | 'VIDEO_COOLDOWN_SUPPRESSED';
};

type DuplicateCheckInput = {
    accountId: string;
    platform: string;
    videoId: string;
    source?: string | null;
    automationRunId?: string | null;
    comment?: {
        author_id?: string | null;
        author_name?: string | null;
        text?: string | null;
    };
};

export function normalizeTextForDuplicateCompare(text: string | null | undefined): string {
    return (text || '')
        .normalize('NFKC')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

export function buildCommentIdentity(comment: { author_name?: string | null; author_id?: string | null }): string {
    const authorId = (comment.author_id || '').trim().toLowerCase();
    const authorName = (comment.author_name || '').trim().toLowerCase();
    return authorId || authorName || 'unknown';
}

export function generateSemanticDedupKey(
    accountId: string,
    platform: string,
    videoId: string,
    comment: { author_name?: string | null; author_id?: string | null; text?: string | null }
): string | null {
    const normalizedText = normalizeTextForDuplicateCompare(comment.text);
    if (!normalizedText) {
        return null;
    }

    return crypto.createHash('sha256')
        .update(`${accountId}:${platform}:${videoId}:${buildCommentIdentity(comment)}:${normalizedText}`)
        .digest('hex');
}

export function parseEventMetadata(raw: unknown): Record<string, any> {
    if (!raw) return {};
    if (typeof raw === 'string') {
        try {
            return JSON.parse(raw);
        } catch {
            return {};
        }
    }
    if (typeof raw === 'object') {
        return raw as Record<string, any>;
    }
    return {};
}

export function extractAutomationRunId(raw: unknown): string | null {
    const meta = parseEventMetadata(raw);
    const runId = meta?.context?.automation_run_id;
    return typeof runId === 'string' && runId.trim() ? runId.trim() : null;
}

export async function findDuplicateSuppression(input: DuplicateCheckInput): Promise<DuplicateSuppression | null> {
    const semanticDedupKey = input.comment
        ? generateSemanticDedupKey(
            input.accountId,
            input.platform,
            input.videoId,
            {
                author_id: input.comment.author_id,
                author_name: input.comment.author_name,
                text: input.comment.text
            }
        )
        : null;

    if (semanticDedupKey) {
        const semanticDuplicate = await prisma.engagementEvent.findUnique({
            where: { semantic_dedup_key: semanticDedupKey },
            select: { id: true }
        });

        if (semanticDuplicate) {
            return {
                existingEventId: semanticDuplicate.id,
                reason: 'SEMANTIC_COMMENT_DUPLICATE',
                ingestStatus: 'DUPLICATE_SUPPRESSED'
            };
        }
    }

    if (input.source !== 'AUTOMATION') {
        return null;
    }

    const settings = await OwnerSettingsService.getSettings(input.accountId);
    const cooldownHours = Math.max(settings.cooldown_hours || 0, 0);
    if (cooldownHours <= 0) {
        return null;
    }

    const cutoff = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);
    const recentVideoEvents = await prisma.engagementEvent.findMany({
        where: {
            account_id: input.accountId,
            platform: input.platform,
            video_id: input.videoId,
            created_at: { gte: cutoff }
        },
        orderBy: { created_at: 'desc' },
        take: 50,
        select: {
            id: true,
            metadata: true
        }
    });

    for (const existing of recentVideoEvents) {
        const existingMeta = parseEventMetadata(existing.metadata);
        const existingSource = existingMeta?.context?.source;
        const existingRunId = extractAutomationRunId(existing.metadata);
        if (
            existingSource === 'AUTOMATION' &&
            (!input.automationRunId || !existingRunId || existingRunId !== input.automationRunId)
        ) {
            return {
                existingEventId: existing.id,
                reason: 'VIDEO_COOLDOWN_ACTIVE',
                ingestStatus: 'VIDEO_COOLDOWN_SUPPRESSED'
            };
        }
    }

    return null;
}
