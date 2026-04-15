import { prisma } from '../../db';
import { IngestionEvent, IngestionEventSchema } from '../../schemas/ingestion_contract';
import * as crypto from 'crypto';
import { PlanEnforcer } from '../product/plan_enforcer';
import { OwnerSettingsService } from '../owner/owner_settings_service';
import { VideoEventAdapter } from '../../adapters/video/video_event_adapter';
import { VideoEvent } from '../../adapters/video/schemas';
import { BrainGateway } from '../brain/brain_gateway';
import { SuggestionService } from '../hitl/suggestion_service';
import { v4 as uuidv4 } from 'uuid';
import { BrandLookupService } from '../brand_lookup_service';
import { findDuplicateSuppression, generateSemanticDedupKey } from './dedup';

export enum IngestStatus {
    RECEIVED = 'RECEIVED',
    DUPLICATE = 'DUPLICATE',
    DUPLICATE_SUPPRESSED = 'DUPLICATE_SUPPRESSED',
    VIDEO_COOLDOWN_SUPPRESSED = 'VIDEO_COOLDOWN_SUPPRESSED',
    BLOCKED_POLICY = 'BLOCKED_POLICY',
    BLOCKED_PLAN = 'BLOCKED_PLAN',
    OBSERVED = 'OBSERVED',
    SUGGESTED = 'SUGGESTED',
    ERROR = 'ERROR'
}

export class IngestionService {

    /**
     * Process a raw ingestion event.
     * Guaranteed 200 OK / Idempotent.
     */
    static async processEvent(
        rawEvent: any,
        installId: string,
        accountId: string,
        correlationId: string = uuidv4()
    ): Promise<{ status: IngestStatus; id?: string; duplicateReason?: string }> {

        // 1. Validation (Schema)
        const parse = IngestionEventSchema.safeParse(rawEvent);
        if (!parse.success) {
            console.warn(`[Ingest][${correlationId}] Schema Invalid:`, parse.error);
            throw new Error('Invalid Schema'); // 400 Bad Request at API layer
        }
        const event = parse.data;
        const canonicalPlatform = this.normalizePlatform(event.platform);

        // 2. Dedup (Primary - External ID)
        const existingPrimary = await prisma.engagementEvent.findUnique({
            where: { external_event_id: event.event_id }
        });
        if (existingPrimary) {
            console.log(`[Ingest][${correlationId}] Dedup Primary Hit: ${event.event_id}`);
            return { status: IngestStatus.DUPLICATE, id: existingPrimary.id };
        }

        // 3. Dedup (Secondary - Content Hash)
        // Key: install_id + platform + video_id + comment_id + raw_text_hash
        const textHash = crypto.createHash('sha256').update(event.raw_text || '').digest('hex');
        const dedupKey = crypto.createHash('sha256')
            .update(`${installId}:${canonicalPlatform}:${event.platform_video_id}:${event.platform_comment_id || 'null'}:${textHash}`)
            .digest('hex');

        const existingSecondary = await prisma.engagementEvent.findUnique({
            where: { dedup_key: dedupKey }
        });
        if (existingSecondary) {
            console.log(`[Ingest][${correlationId}] Dedup Secondary Hit: ${dedupKey}`);
            return { status: IngestStatus.DUPLICATE, id: existingSecondary.id };
        }

        const semanticDedupKey = generateSemanticDedupKey(
            accountId,
            canonicalPlatform,
            event.platform_video_id,
            {
                author_id: event.platform_comment_author_id || null,
                author_name: event.platform_comment_author_name || null,
                text: event.raw_text || null
            }
        );

        const suppression = await findDuplicateSuppression({
            accountId,
            platform: canonicalPlatform,
            videoId: event.platform_video_id,
            source: event.source || 'EXTENSION',
            automationRunId: event.automation_run_id || null,
            comment: {
                author_id: event.platform_comment_author_id || null,
                author_name: event.platform_comment_author_name || null,
                text: event.raw_text || null
            }
        });

        if (suppression) {
            console.log(`[Ingest][${correlationId}] Duplicate Suppressed: ${suppression.reason}`);
            return {
                status: suppression.ingestStatus === 'VIDEO_COOLDOWN_SUPPRESSED'
                    ? IngestStatus.VIDEO_COOLDOWN_SUPPRESSED
                    : IngestStatus.DUPLICATE_SUPPRESSED,
                id: suppression.existingEventId,
                duplicateReason: suppression.reason
            };
        }

        let status = IngestStatus.RECEIVED;
        try {
            await PlanEnforcer.assertPlatformAccess(accountId, canonicalPlatform);
            await PlanEnforcer.consumeLimit(accountId, 'events_per_day');
            await PlanEnforcer.consumeLimit(accountId, 'events_per_month');
        } catch (e) {
            console.warn(`[Ingest][${correlationId}] Plan Limit Exceeded:`, e);
            status = IngestStatus.BLOCKED_PLAN;
        }

        // 4.5 Resolve Brand (Strict)
        let brandId: string | null = null;
        try {
            brandId = await BrandLookupService.resolveBrand(accountId, event.brand_id);
        } catch (e) {
            console.warn(`[Ingest][${correlationId}] Brand Resolution Failed:`, e);
            return { status: IngestStatus.ERROR };
        }

        if (!brandId) {
            console.warn(`[Ingest][${correlationId}] No Brand found for Account ${accountId}`);
            return { status: IngestStatus.ERROR };
        }

        // 5. Persistence (Immutable)
        const engagementEvent = await prisma.engagementEvent.create({
            data: {
                external_event_id: event.event_id,
                dedup_key: dedupKey,
                semantic_dedup_key: semanticDedupKey,
                platform: canonicalPlatform,
                video_id: event.platform_video_id,
                comment_id: event.platform_comment_id || 'null',
                content_text: event.raw_text || '',
                target_id: 'unknown',
                account_id: accountId,
                install_id: installId,
                brand_id: brandId,
                status: status,
                observed_at: new Date(event.observed_at),
                metadata: {
                    ...event,
                    platform: canonicalPlatform,
                    context: {
                        source: event.source || 'EXTENSION',
                        automation_run_id: event.automation_run_id || null
                    },
                    correlation_id: correlationId
                } as any
            }
        });


        if (status === IngestStatus.BLOCKED_PLAN) {
            return { status: IngestStatus.BLOCKED_PLAN, id: engagementEvent.id };
        }

        // 6. Logic (Observe vs Suggest)
        try {
            const settings = await OwnerSettingsService.getSettings(accountId);

            // Mode Check
            if (settings.mode === 'OBSERVE_ONLY') {
                await prisma.engagementEvent.update({
                    where: { id: engagementEvent.id },
                    data: { status: IngestStatus.OBSERVED }
                });
                console.log(`[Ingest][${correlationId}] Mode OBSERVE -> Stopped.`);
                return { status: IngestStatus.OBSERVED, id: engagementEvent.id };
            }

            // SUGGEST Mode
            console.log(`[Ingest][${correlationId}] Triggering Suggestion Pipeline...`);

            // Invoke Pipeline (Reusing logic from triggerAutoSuggest but cleaner)
            // Adapter
            const videoEvent: VideoEvent = {
                platform: canonicalPlatform as any,
                video_id: event.platform_video_id,
                creator_id: 'unknown', // Explicit no enrichment
                creator_name: 'unknown',
                video_title: 'unknown',
                video_description: '',
                video_tags: [],
                timestamp: event.observed_at, // Use source time
                session_id: 'ingest_session',
                install_id: installId,
                text: event.raw_text || ''
            };

            const req = VideoEventAdapter.toCapabilityRequest(videoEvent);
            req.tenant_id = installId;
            if (!req.context) req.context = {};
            req.context.raw_event = {
                account_id: accountId,
                correlation_id: correlationId // Propagate!
            };

            // Brain Call
            const resp = await BrainGateway.processCapability(req);

            // Value Outcome
            if ((resp.kind as any) === 'ignore' || (resp.kind as any) === 'error') {
                await prisma.engagementEvent.update({
                    where: { id: engagementEvent.id },
                    data: { status: (resp.kind as any) === 'error' ? 'ERROR' : 'IGNORED' } // Or 'OBSERVED'? Plan says 'OBSERVED' is for mode. Just use IGNORED.
                });
                return { status: IngestStatus.OBSERVED, id: engagementEvent.id };
            }

            // Create Suggestion
            const p = resp.payload as any;
            await SuggestionService.createSuggestion({
                workspaceId: accountId,
                eventId: engagementEvent.id,
                platform: canonicalPlatform,
                videoId: event.platform_video_id,
                commentId: event.platform_comment_id || 'null',
                text: p?.text || '',
                strategy: p?.strategy,
                confidence: resp.confidence ?? 0,
                signals: JSON.stringify(resp.policy_decisions || {}),
                ownerSettingsSnapshot: JSON.stringify(settings)
            });

            await prisma.engagementEvent.update({
                where: { id: engagementEvent.id },
                data: { status: IngestStatus.SUGGESTED }
            });

            return { status: IngestStatus.SUGGESTED, id: engagementEvent.id };

        } catch (err) {
            console.error(`[Ingest][${correlationId}] Pipeline Error:`, err);
            await prisma.engagementEvent.update({
                where: { id: engagementEvent.id },
                data: { status: IngestStatus.ERROR }
            }).catch((updateErr) => {
                console.error(`[Ingest][${correlationId}] Failed to persist ERROR status:`, updateErr);
            });
            return { status: IngestStatus.ERROR, id: engagementEvent.id };
        }
    }

    private static normalizePlatform(platform: IngestionEvent['platform']): string {
        switch (platform) {
            case 'TIKTOK':
                return 'tiktok';
            case 'YOUTUBE':
                return 'youtube';
            case 'IG':
                return 'instagram';
            case 'REDNOTE':
                return 'rednote';
            default:
                return 'other';
        }
    }
}
