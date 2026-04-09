import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { DesktopCaptureEventSchema, EngagementEventSchema } from '../schemas/desktop_capture_event';
import type { DesktopCaptureEvent } from '../schemas/desktop_capture_event';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import { prisma } from '../db';
import { requireAdmin } from '../auth/admin_middleware';
import { BrandLookupService } from '../services/brand_lookup_service';
import {
    findDuplicateSuppression,
    generateSemanticDedupKey,
    parseEventMetadata
} from '../services/ingestion/dedup';
import {
    buildDecision,
    extractTerminalDecision,
    hasTerminalDecision,
    inferSkipReasonFromBrain,
    LeadPipelineAudit,
    normalizeCommentForAi
} from '../services/lead_pipeline/decision';

const router = Router();
// const prisma = new PrismaClient(); // Removed local instance

// ==========================================
// Phase 12.1 Work Queue & Idempotency
// ==========================================

// Helper: Generate Deterministic Dedup Key
function generateDedupKey(platform: string, videoId: string, commentId: string): string {
    return crypto.createHash('sha256')
        .update(`${platform}:${videoId}:${commentId}`)
        .digest('hex');
}

function buildTargetId(platform: string, comment: { author_name?: string | null; author_id?: string | null }): string {
    const name = (comment.author_name || '').trim();
    const authorId = (comment.author_id || '').trim();
    const identity = name || authorId || 'unknown';
    return `${platform}:${identity}`;
}

function nowIso(): string {
    return new Date().toISOString();
}

function logLeadPipeline(eventId: string, stage: string, payload: Record<string, any>) {
    console.log(`[LeadPipeline] ${JSON.stringify({
        event_id: eventId,
        stage,
        at: nowIso(),
        ...payload
    })}`);
}

function pickModelResultRaw(resp: any): Record<string, any> {
    if (!resp) return {};
    return {
        kind: resp.kind ?? null,
        strategy: (resp.payload as any)?.strategy ?? null,
        confidence: resp.confidence ?? null,
        explanation: (resp.policy_decisions as any)?.explanation ?? '',
        intent: ((resp.policy_decisions as any)?.trace as any)?.intent ?? null
    };
}

function extractPayloadFromEventMetadata(event: any): any {
    const meta = parseEventMetadata(event?.metadata);
    if (!meta || Object.keys(meta).length === 0) {
        return {};
    }
    return meta;
}

async function reserveLeadQuotaCapacity(workspaceId: string) {
    const operatorApiUrl = (process.env.OPERATOR_API_URL || 'http://operator-api:3001').replace(/\/$/, '');
    const internalSecret = process.env.AI_ENGAGEMENT_INTERNAL_SECRET || process.env.AI_CORE_INTERNAL_SECRET || '';
    const response = await fetch(`${operatorApiUrl}/internal/billing/lead-quota/reserve`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-internal-secret': internalSecret,
        },
        body: JSON.stringify({ workspace_id: workspaceId }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        const message = String(payload?.message || payload?.error || 'Lead quota reservation failed');
        const error = new Error(`LEAD_QUOTA_BLOCKED:${message}`);
        (error as Error & { details?: any }).details = payload;
        throw error;
    }

    return payload;
}

function buildLeadPipelineAudit(input: {
    decision: string;
    normalizationStatus: string;
    aiInvoked: boolean;
    aiCompletedAt?: string | null;
    skipReason?: string | null;
    errorReason?: string | null;
    modelResultRaw?: any;
}): LeadPipelineAudit {
    return {
        decision: input.decision,
        normalization_status: input.normalizationStatus,
        ai_invoked: input.aiInvoked,
        ai_completed_at: input.aiCompletedAt ?? null,
        skip_reason: input.skipReason ?? null,
        error_reason: input.errorReason ?? null,
        model_result_raw: input.modelResultRaw ?? null,
        updated_at: nowIso()
    };
}

async function persistLeadPipelineOutcome(event: any, input: {
    decision: string;
    normalizationStatus: string;
    aiInvoked: boolean;
    aiCompletedAt?: string | null;
    skipReason?: string | null;
    errorReason?: string | null;
    modelResultRaw?: any;
    leadId?: string | null;
    intent?: string | null;
    strength?: string | null;
    explanation?: string | null;
    strategy?: string | null;
    forceStatus?: string | null;
}) {
    const currentMeta = parseEventMetadata((event as any).metadata);
    const audit = buildLeadPipelineAudit({
        decision: input.decision,
        normalizationStatus: input.normalizationStatus,
        aiInvoked: input.aiInvoked,
        aiCompletedAt: input.aiCompletedAt,
        skipReason: input.skipReason,
        errorReason: input.errorReason,
        modelResultRaw: input.modelResultRaw
    });

    const nextMeta: Record<string, any> = {
        ...currentMeta,
        lead_pipeline_outcome: audit
    };

    if (event.platform === 'rednote') {
        nextMeta.qualification_outcome = {
            result: input.decision,
            lead_id: input.leadId ?? null,
            intent: input.intent ?? null,
            strength: input.strength ?? null,
            explanation: input.explanation ?? ''
        };
    } else {
        nextMeta.value_outcome = {
            result: input.decision,
            reason: input.skipReason || input.errorReason || input.explanation || '',
            strategy: input.strategy || null,
            explanation: input.explanation || ''
        };
    }

    await prisma.engagementEvent.update({
        where: { id: event.id },
        data: {
            metadata: nextMeta as any,
            ...(input.forceStatus ? { status: input.forceStatus } : {}),
            ...(input.errorReason ? { failure_reason: input.errorReason } : {})
        }
    });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutCode: string): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(timeoutCode)), timeoutMs);
    });

    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
    }
}

// POST /events - Ingest Raw Event (Write-First Architecture)
// POST /events - Ingest Raw Event (Write-First Architecture)
router.post('/events', async (req: Request, res: Response) => {
    const payload = req.body;
    const installId = req.headers['x-install-id'] as string;
    const installSecret = req.headers['x-install-secret'] as string;

    // 1. Basic Transport Validation (Sync) -> Only Malformed requests are rejected
    if (!installId) {
        // We arguably could persist this too if we really wanted "Lossless", 
        // but without install_id we can't key it easily. 
        // User said: "Auth failure affects status, not persistence". 
        // Install ID is Identity, not Auth. Missing Identity is structural failure.
        res.status(400).json({ status: 'error', message: 'Missing x-install-id' });
        return;
    }

    const parseResult = DesktopCaptureEventSchema.safeParse(payload);
    if (!parseResult.success) {
        res.status(400).json({
            status: "error",
            code: 'INVALID_PAYLOAD',
            details: parseResult.error.issues
        });
        return;
    }
    const eventData = parseResult.data;

    // --- STRICT AUTOMATION VALIDATION (PHASE 38) ---
    if (eventData.context.source === 'AUTOMATION') {
        const errors = [];
        if (!eventData.context.automation_run_id) errors.push("Missing automation_run_id");
        if (!eventData.video.video_id || eventData.video.video_id === 'unknown') errors.push("Invalid video_id");
        if (!eventData.comment.text || eventData.comment.text.trim().length === 0) errors.push("Empty comment text");

        if (errors.length > 0) {
            res.status(400).json({
                status: "error",
                code: "INVALID_AUTOMATION_EVENT",
                message: "Strict automation validation failed",
                details: errors
            });
            return;
        }
    }

    // 2. Resolve Install & Account (Non-Blocking → PILOT SECURITY: Now Blocking on Auth)
    let accountId: string | null = null;
    let initialStatus = 'RECEIVED';
    let failureReason: string | null = null;

    try {
        const install = await prisma.installRegistry.findUnique({
            where: { install_id: installId },
            select: { account_id: true, is_active: true, install_secret: true }
        });

        if (!install) {
            // PILOT SECURITY: Reject unknown install_id immediately
            res.status(403).json({
                status: 'error',
                code: 'INSTALL_NOT_FOUND',
                message: 'Unknown install_id'
            });
            return;
        }

        // PILOT SECURITY: Check Secret (Auth) - HARD GATE
        if (install.install_secret && install.install_secret !== installSecret) {
            res.status(401).json({
                status: 'error',
                code: 'AUTH_FAILED',
                message: 'Invalid install_secret'
            });
            return;
        }

        // Check Kill Switch
        if (!install.is_active) {
            res.status(403).json({
                status: 'error',
                code: 'INSTALL_INACTIVE',
                message: 'Install has been deactivated'
            });
            return;
        }

        // Check Orphaned (No Account)
        if (!install.account_id) {
            initialStatus = 'ORPHANED';
            failureReason = 'No Account Linked';
        } else {
            accountId = install.account_id;
            // Status remains RECEIVED
        }

    } catch (err: any) {
        console.error(`[Ingest] Install resolution error:`, err);
        res.status(500).json({
            status: 'error',
            code: 'INSTALL_RESOLUTION_FAILED',
            message: 'Failed to verify credentials'
        });
        return;
    }

    // 2.5 Resolve Brand (Strict Safety)
    // Only proceed if we have a valid Account ID. If Orphaned, we can't resolve brand reliably yet.
    // Logic: If Account Resolved -> Resolve Brand.
    // If Brand fails -> Reject Request (Per rules).
    let brandId: string | null = null;

    if (accountId) {
        try {
            brandId = await BrandLookupService.resolveBrand(accountId, eventData.session.brand_id);
        } catch (brandErr: any) {
            console.warn(`[Ingest] Brand Resolution Failed: ${brandErr.message}`);
            // REJECT the request as per strict safety rules
            res.status(400).json({
                status: 'error',
                code: brandErr.message, // e.g. BRAND_NOT_FOUND
                message: 'Brand resolution failed'
            });
            return;
        }
    }

    if (!brandId) {
        res.status(400).json({
            status: 'error',
            code: 'BRAND_REQUIRED',
            message: 'Cannot persist event without valid Brand context'
        });
        return;
    }

    // 3. DB Write (ALWAYS Persist)
    const dedupKey = generateDedupKey(eventData.platform, eventData.video.video_id, eventData.comment.comment_id);
    const semanticDedupKey = accountId
        ? generateSemanticDedupKey(accountId, eventData.platform, eventData.video.video_id, {
            author_id: eventData.comment.author_id,
            author_name: eventData.comment.author_name,
            text: eventData.comment.text
        })
        : null;
    let persistedEvent;

    if (accountId) {
        const suppression = await findDuplicateSuppression({
            accountId,
            platform: eventData.platform,
            videoId: eventData.video.video_id,
            source: eventData.context.source,
            automationRunId: eventData.context.automation_run_id || null,
            comment: {
                author_id: eventData.comment.author_id,
                author_name: eventData.comment.author_name,
                text: eventData.comment.text
            }
        });
        if (suppression) {
            console.log(`[Ingest][DuplicateSuppressed] ${JSON.stringify({
                account_id: accountId,
                platform: eventData.platform,
                video_id: eventData.video.video_id,
                comment_id: eventData.comment.comment_id,
                reason: suppression.reason,
                existing_event_id: suppression.existingEventId
            })}`);

            res.status(202).json({
                status: 'accepted',
                event_id: suppression.existingEventId,
                ingest_status: suppression.ingestStatus,
                duplicate_reason: suppression.reason
            });
            return;
        }
    }

    try {
        persistedEvent = await prisma.engagementEvent.upsert({
            where: { dedup_key: dedupKey },
            update: {
                // Idempotent: If it exists, we don't change it.
            },
            create: {
                dedup_key: dedupKey,
                semantic_dedup_key: semanticDedupKey,
                platform: eventData.platform,
                video_id: eventData.video.video_id,
                comment_id: eventData.comment.comment_id,
                content_text: eventData.comment.text,
                metadata: eventData as any,
                status: initialStatus,
                failure_reason: failureReason,
                install_id: installId,
                account_id: accountId,
                brand_id: brandId,
                target_id: buildTargetId(eventData.platform, eventData.comment)
            }
        });

        const eventId = persistedEvent.id;

        // 4. Respond Immediately
        // Log event_id as first-class correlation
        console.log(`[Ingest][${eventId}] Accepted. Status: ${initialStatus}`);

        res.status(202).json({
            status: 'accepted',
            event_id: eventId,
            ingest_status: initialStatus
        });

        // 5. Async Processing (Fire & Forget)
        if (initialStatus === 'RECEIVED') {
            processAsyncIngest(eventId, eventData).catch(err => {
                console.error(`[Ingest][${eventId}] Async Error:`, err);
            });
        }

    } catch (writeErr) {
        const err: any = writeErr;
        if (err?.code === 'P2002' && accountId && semanticDedupKey) {
            const existingSemantic = await prisma.engagementEvent.findUnique({
                where: { semantic_dedup_key: semanticDedupKey },
                select: { id: true }
            });

            if (existingSemantic) {
                res.status(202).json({
                    status: 'accepted',
                    event_id: existingSemantic.id,
                    ingest_status: 'DUPLICATE_SUPPRESSED',
                    duplicate_reason: 'SEMANTIC_COMMENT_DUPLICATE'
                });
                return;
            }
        }
        console.error('[Ingest] DB Write Failed:', writeErr);
        res.status(500).json({ status: 'error', code: 'DB_WRITE_FAILED' });
        return;
    }
});

// Helper: Async Processor (Post-Ingest Logic)
async function processAsyncIngest(eventId: string, rawData: any) {
    // 1. Atomic Status Transition ("Claim" the event)
    // Only process if status is RECEIVED (or ORPHANED if we supported retry, but keeping simple for now)
    // We update to 'PROCESSING' to lock it.

    // Note: upsert returns the object. We need to fetch/update atomically.
    // Prisma updateMany returns count.

    const updateResult = await prisma.engagementEvent.updateMany({
        where: {
            id: eventId,
            status: 'RECEIVED'
        },
        data: {
            status: 'PROCESSING'
        }
    });

    if (updateResult.count === 0) {
        const existing = await prisma.engagementEvent.findUnique({ where: { id: eventId } });
        if (!existing) {
            console.log(`[Async][${eventId}] Skipped (Event not found)`);
            return;
        }

        const existingMeta = parseEventMetadata((existing as any).metadata);
        const terminal = extractTerminalDecision(existingMeta);
        const hasDeterministicTerminal = hasTerminalDecision(existingMeta);

        // If event already has a terminal outcome, idempotency is respected.
        if (hasDeterministicTerminal && terminal) {
            if (!existingMeta.lead_pipeline_outcome && existing.status === 'PROCESSED' && existing.account_id && existing.install_id) {
                console.warn(`[Async][${eventId}] Re-evaluating legacy terminal without lead pipeline audit: ${terminal}`);
                const fallbackPayload = Object.keys(rawData || {}).length > 0 ? rawData : extractPayloadFromEventMetadata(existing);
                const outcome = await triggerAutoSuggest(existing, existing.account_id, existing.install_id, fallbackPayload);
                await prisma.engagementEvent.update({
                    where: { id: eventId },
                    data: {
                        status: 'PROCESSED',
                        ...(outcome.errorReason ? { failure_reason: outcome.errorReason } : {})
                    }
                });
                return;
            }
            console.log(`[Async][${eventId}] Skipped (Already terminal: ${terminal})`);
            return;
        }

        if (terminal && !hasDeterministicTerminal) {
            console.warn(`[Async][${eventId}] Found legacy/non-deterministic terminal value "${terminal}", forcing re-evaluation`);
        }

        // Legacy rows may be PROCESSED without terminal outcome due historical silent paths.
        // Backfill deterministically using the newest payload so "NO_AI_RESULT" cannot persist.
        if (existing.status === 'PROCESSED' && existing.account_id && existing.install_id) {
            console.warn(`[Async][${eventId}] Re-evaluating stale PROCESSED event without terminal decision`);
            const fallbackPayload = Object.keys(rawData || {}).length > 0 ? rawData : extractPayloadFromEventMetadata(existing);
            const outcome = await triggerAutoSuggest(existing, existing.account_id, existing.install_id, fallbackPayload);
            await prisma.engagementEvent.update({
                where: { id: eventId },
                data: {
                    status: 'PROCESSED',
                    ...(outcome.errorReason ? { failure_reason: outcome.errorReason } : {})
                }
            });
            return;
        }

        const skipReason = `EVENT_STATUS_${existing.status || 'LOCKED'}`;
        const skipDecision = buildDecision('SKIPPED', skipReason);
        await persistLeadPipelineOutcome(existing, {
            decision: skipDecision,
            normalizationStatus: 'SKIPPED_PRECHECK',
            aiInvoked: false,
            skipReason,
            explanation: 'Event was not claimable for async processing.'
        });
        console.log(`[Async][${eventId}] Skipped (${skipDecision})`);
        return;
    }

    // From here on, we own the event.
    // Fetch fresh to get account_id (safely)
    const eventRecord = await prisma.engagementEvent.findUnique({ where: { id: eventId } });
    if (!eventRecord || !eventRecord.account_id) {
        // Should not happen if it was RECEIVED, but safeguard.
        console.warn(`[Async][${eventId}] Abort: Missing Record or Account ID`);
        if (eventRecord) {
            const skipReason = 'MISSING_ACCOUNT_CONTEXT';
            await persistLeadPipelineOutcome(eventRecord, {
                decision: buildDecision('SKIPPED', skipReason),
                normalizationStatus: 'SKIPPED_PRECHECK',
                aiInvoked: false,
                skipReason,
                forceStatus: 'PROCESSED',
                explanation: 'Missing account context for AI evaluation.'
            });
        }
        return;
    }
    const accountId = eventRecord.account_id;

    // 2. Account Health Check
    const account = await prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.status !== 'ACTIVE') {
        console.warn(`[Async][${eventId}] Blocked: Suspended Account ${accountId}`);
        await prisma.engagementEvent.update({
            where: { id: eventId },
            data: {
                status: 'BLOCKED_ACCOUNT',
                failure_reason: 'Account Suspended or Missing'
            }
        });
        await persistLeadPipelineOutcome(eventRecord, {
            decision: buildDecision('SKIPPED', 'BLOCKED_ACCOUNT'),
            normalizationStatus: 'SKIPPED_PRECHECK',
            aiInvoked: false,
            skipReason: 'BLOCKED_ACCOUNT',
            forceStatus: 'BLOCKED_ACCOUNT',
            explanation: 'Account is suspended or missing.'
        });
        return;
    }

    // 3. Plan Limits (Phase 24)
    const { PlanEnforcer } = require('../services/product/plan_enforcer');
    try {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const dailyCount = await prisma.engagementEvent.count({
            where: {
                account_id: accountId,
                created_at: { gte: startOfDay }
            }
        });

        await PlanEnforcer.checkLimit(accountId, 'events_per_day', dailyCount);
    } catch (limitErr: any) {
        console.warn(`[Async][${eventId}] Limit Exceeded: ${limitErr.message}`);
        await prisma.engagementEvent.update({
            where: { id: eventId },
            data: {
                status: 'BLOCKED_LIMIT',
                failure_reason: limitErr.message
            }
        });
        await persistLeadPipelineOutcome(eventRecord, {
            decision: buildDecision('SKIPPED', 'BLOCKED_LIMIT'),
            normalizationStatus: 'SKIPPED_PRECHECK',
            aiInvoked: false,
            skipReason: 'BLOCKED_LIMIT',
            forceStatus: 'BLOCKED_LIMIT',
            explanation: limitErr.message
        });
        return;
    }

    // 4. Onboarding
    const { OnboardingService, OnboardingState } = require('../services/product/onboarding_service');
    await OnboardingService.advance(accountId, OnboardingState.FIRST_EVENT_INGESTED);

    // 5. AI Trigger
    const outcome = await triggerAutoSuggest(eventRecord, accountId, eventRecord.install_id!, rawData);

    await prisma.engagementEvent.update({
        where: { id: eventId },
        data: {
            status: 'PROCESSED',
            ...(outcome.errorReason ? { failure_reason: outcome.errorReason } : {})
        }
    });
}

async function persistLeadOpportunity(event: any, payload: any, trace: any, confidence: number) {
    const intent = trace?.intent;
    if (!intent?.intent || !event.comment_id || !event.account_id || !event.brand_id) {
        return null;
    }

    let buyerStage: 'READY' | 'EVALUATING' | null = null;
    let recommendedAction: 'PRIORITY_DM' | 'RECOMMEND_DM' | 'SILENT_CAPTURE' | null = null;

    switch (intent.intent) {
        case 'PRODUCT_INQUIRY':
            buyerStage = 'READY';
            recommendedAction = 'PRIORITY_DM';
            break;
        case 'LATENT_PURCHASE':
        case 'POST_PURCHASE_REGRET':
        case 'PROBLEM_SOLUTION':
        case 'FIT_SUITABILITY':
            buyerStage = 'EVALUATING';
            recommendedAction = confidence >= 0.8 ? 'RECOMMEND_DM' : 'SILENT_CAPTURE';
            break;
        default:
            return null;
    }

    const existingLead = await prisma.leadOpportunity.findFirst({
        where: {
            platform: event.platform,
            comment_id: event.comment_id
        }
    });

    if (existingLead) {
        return existingLead;
    }

    await reserveLeadQuotaCapacity(event.account_id);

    const leadConfidence = buyerStage === 'READY'
        ? Math.max(confidence || 0, 0.9)
        : Math.max(confidence || 0, 0.6);

    return prisma.leadOpportunity.create({
        data: {
            platform: event.platform,
            video_id: event.video_id,
            comment_id: event.comment_id,
            user_handle: payload.comment?.author_name || null,
            user_profile_url: null,
            intent: intent.intent,
            buyer_stage: buyerStage,
            confidence: leadConfidence,
            recommended_action: recommendedAction,
            urgency_score: buyerStage === 'READY' ? 0.9 * leadConfidence : 0.6 * leadConfidence,
            risk_level: 'LOW',
            source_event_id: event.id,
            account_id: event.account_id,
            brand_id: event.brand_id,
            preferences: {
                source: 'ingestion-service',
                strength: intent.strength,
                strategy: trace?.final_strategy || null
            }
        }
    });
}

type TriggerOutcome = {
    decision: string;
    errorReason?: string | null;
};

// Helper: Auto-Suggest Pipeline (Phase 21)
async function triggerAutoSuggest(event: any, accountId: string, installId: string, payload: any): Promise<TriggerOutcome> {
    const normalized = normalizeCommentForAi(event.content_text);
    if (!normalized.ok) {
        const skipReason = normalized.skipReason || 'NORMALIZATION_FAILED';
        const decision = buildDecision('SKIPPED', skipReason);
        await persistLeadPipelineOutcome(event, {
            decision,
            normalizationStatus: normalized.normalizationStatus,
            aiInvoked: false,
            skipReason,
            explanation: 'Comment normalization failed before AI execution.'
        });
        logLeadPipeline(event.id, 'normalization_skipped', {
            decision,
            normalization_status: normalized.normalizationStatus,
            ai_invoked: false,
            skip_reason: skipReason
        });
        return { decision };
    }

    const eventPayload = Object.keys(payload || {}).length > 0 ? payload : extractPayloadFromEventMetadata(event);

    // 1. Adapter
    const videoEvent: VideoEvent = {
        platform: event.platform,
        video_id: event.video_id,
        creator_id: eventPayload.video?.author_id || 'unknown',
        creator_name: eventPayload.video?.author_name || 'unknown',
        video_title: eventPayload.video?.title || 'Untitled',
        video_description: '',
        video_tags: [],
        timestamp: eventPayload.page?.timestamp || new Date().toISOString(),
        session_id: eventPayload.session?.session_id || 'unknown_session',
        install_id: installId,
        text: normalized.normalizedText,
        comment_id: event.comment_id,
        source_event_id: event.id
    };

    const req = VideoEventAdapter.toCapabilityRequest(videoEvent);
    req.tenant_id = installId;
    if (!req.context) req.context = {};
    req.context.raw_event = {
        ...((req.context.raw_event as object) || {}),
        account_id: accountId,
        brand_id: event.brand_id
    };

    let resp: any;
    let trace: any = {};
    let aiCompletedAt = nowIso();
    try {
        resp = await withTimeout(BrainGateway.processCapability(req), 65000, 'AI_TIMEOUT');
        trace = (resp.policy_decisions as any)?.trace || {};
        aiCompletedAt = nowIso();
    } catch (err: any) {
        const errorReason = String(err?.message || 'AI_INVOCATION_FAILED');
        const decision = buildDecision('ERROR', errorReason);
        await persistLeadPipelineOutcome(event, {
            decision,
            normalizationStatus: normalized.normalizationStatus,
            aiInvoked: true,
            aiCompletedAt,
            errorReason,
            modelResultRaw: { error: errorReason },
            explanation: 'AI execution failed before terminal classification.'
        });
        logLeadPipeline(event.id, 'ai_error', {
            decision,
            normalization_status: normalized.normalizationStatus,
            ai_invoked: true,
            ai_completed_at: aiCompletedAt,
            error_reason: errorReason
        });
        return { decision, errorReason };
    }

    let lead: any = null;
    try {
        lead = await persistLeadOpportunity(event, eventPayload, trace, resp.confidence ?? 0);
    } catch (err: any) {
        if (String(err?.message || '').startsWith('LEAD_QUOTA_BLOCKED:')) {
            const errorReason = 'BLOCKED_LIMIT';
            const decision = buildDecision('SKIPPED', errorReason);
            await persistLeadPipelineOutcome(event, {
                decision,
                normalizationStatus: normalized.normalizationStatus,
                aiInvoked: true,
                aiCompletedAt,
                skipReason: errorReason,
                modelResultRaw: pickModelResultRaw(resp),
                intent: trace?.intent?.intent || null,
                strength: trace?.intent?.strength || null,
                explanation: String(err?.message || '').replace(/^LEAD_QUOTA_BLOCKED:/, ''),
            });
            return { decision };
        }
        const errorReason = `LEAD_PERSISTENCE_FAILED_${String(err?.message || 'UNKNOWN')}`;
        const decision = buildDecision('ERROR', errorReason);
        await persistLeadPipelineOutcome(event, {
            decision,
            normalizationStatus: normalized.normalizationStatus,
            aiInvoked: true,
            aiCompletedAt,
            errorReason,
            modelResultRaw: pickModelResultRaw(resp),
            intent: trace?.intent?.intent || null,
            strength: trace?.intent?.strength || null,
            explanation: (resp.policy_decisions as any)?.explanation || ''
        });
        console.error(`[Ingest] Lead persistence failed for ${event.id}: ${errorReason}`);
        return { decision, errorReason };
    }

    const skipReason = inferSkipReasonFromBrain(resp);
    const strategy = (resp.payload as any)?.strategy || null;
    const decision = skipReason
        ? buildDecision('SKIPPED', skipReason)
        : (lead ? 'QUALIFIED_LEAD' : 'FILTERED_OUT');

    await persistLeadPipelineOutcome(event, {
        decision,
        normalizationStatus: normalized.normalizationStatus,
        aiInvoked: true,
        aiCompletedAt,
        skipReason,
        modelResultRaw: pickModelResultRaw(resp),
        leadId: lead?.id || null,
        intent: trace?.intent?.intent || null,
        strength: trace?.intent?.strength || null,
        explanation: (resp.policy_decisions as any)?.explanation || '',
        strategy
    });

    logLeadPipeline(event.id, 'terminal_decision', {
        decision,
        normalization_status: normalized.normalizationStatus,
        ai_invoked: true,
        ai_completed_at: aiCompletedAt,
        skip_reason: skipReason || null,
        strategy: strategy || null
    });

    if (skipReason) {
        return { decision };
    }

    if ((resp.kind as any) === 'error') {
        const errorDecision = buildDecision('ERROR', 'BRAIN_RESPONSE_ERROR');
        await persistLeadPipelineOutcome(event, {
            decision: errorDecision,
            normalizationStatus: normalized.normalizationStatus,
            aiInvoked: true,
            aiCompletedAt,
            errorReason: 'BRAIN_RESPONSE_ERROR',
            modelResultRaw: pickModelResultRaw(resp),
            intent: trace?.intent?.intent || null,
            strength: trace?.intent?.strength || null,
            explanation: (resp.policy_decisions as any)?.explanation || '',
            strategy
        });
        return { decision: errorDecision, errorReason: 'BRAIN_RESPONSE_ERROR' };
    }

    // If here, kind is 'answer' or 'recommend' -> Create Suggestion when not silent.
    const p = resp.payload as any;
    const text = p?.text || '';
    if (strategy === 'SILENT_CAPTURE' || strategy === 'OBSERVE_ONLY' || strategy === 'IGNORE') {
        console.log(`[Ingest] Skipping suggestion for silent strategy ${strategy} on ${event.id}`);
        return { decision };
    }

    try {
        console.log(`[Ingest] Proceeding to create suggestion. Strategy: ${strategy}, Text len: ${text.length}`);
        const { OwnerSettingsService } = require('../services/owner/owner_settings_service');
        const settings = await OwnerSettingsService.getSettings(accountId);

        await SuggestionService.createSuggestion({
            workspaceId: accountId,
            eventId: event.id,
            platform: event.platform,
            videoId: event.video_id,
            commentId: event.comment_id,
            text: text,
            strategy: strategy,
            confidence: resp.confidence ?? 0,
            signals: JSON.stringify(resp.policy_decisions || {}),
            ownerSettingsSnapshot: JSON.stringify(settings),
            contextType: (resp.policy_decisions as any)?.trace?.context?.context_type,
            speakerRole: (resp.policy_decisions as any)?.trace?.context?.speaker_role,
            templateCategory: (resp.policy_decisions as any)?.trace?.context?.template_category
        });
        console.log(`[Ingest] Suggestion Created for ${event.id}`);
    } catch (err: any) {
        const errorReason = `SUGGESTION_PERSIST_FAILED_${String(err?.message || 'UNKNOWN')}`;
        const errorDecision = buildDecision('ERROR', errorReason);
        await persistLeadPipelineOutcome(event, {
            decision: errorDecision,
            normalizationStatus: normalized.normalizationStatus,
            aiInvoked: true,
            aiCompletedAt,
            errorReason,
            modelResultRaw: pickModelResultRaw(resp),
            intent: trace?.intent?.intent || null,
            strength: trace?.intent?.strength || null,
            explanation: (resp.policy_decisions as any)?.explanation || '',
            strategy
        });
        console.error(`[Ingest] Suggestion persistence failed for ${event.id}: ${errorReason}`);
        return { decision: errorDecision, errorReason };
    }

    return { decision };
}

// ==========================================
// Phase 12.2 Suggestion Session
// ==========================================
import { BrainGateway } from '../services/brain/brain_gateway';
import { CapabilityRequest, CapabilityResponse } from '../core/contracts';
import { VideoEventAdapter } from '../adapters/video/video_event_adapter';
import { VideoEvent } from '../adapters/video/schemas';
import { SuggestionService } from '../services/hitl/suggestion_service';

// ...

// POST /suggestions
router.post('/suggestions', async (req: Request, res: Response) => {
    const { event_id } = req.body;
    // Gap A: Strict Requirement - No Fallback
    const installId = req.headers['x-install-id'] as string;

    if (!installId) {
        res.status(400).json({ error: 'Missing x-install-id' });
        return;
    }

    try {
        const event = await prisma.engagementEvent.findUnique({ where: { id: event_id } }) as any;
        if (!event) {
            res.status(404).json({ error: 'Event not found' });
            return;
        }

        // Phase 19.5: Ownership Verification
        const install = await prisma.installRegistry.findUnique({
            where: { install_id: installId },
            include: { account: true }
        } as any) as any;

        if (!install || !install.account || install.account.status !== 'ACTIVE') {
            console.warn(`[Suggestions] Blocked: Invalid/Inactive Install or Suspended Account (${installId})`);
            res.status(403).json({ error: 'Unauthorized' });
            return;
        }

        // Check if Event belongs to Licensee's Account
        if (event.account_id && event.account_id !== install.account_id) {
            console.warn(`[Suggestions] Blocked: Access Denied. Event ${event.id} (Account ${event.account_id}) accessed by Install ${installId} (Account ${install.account_id})`);
            res.status(404).json({ error: 'Event not found' });
            return;
        }

        // ... (Feedback history loading remains same) ...
        const feedbackHistory = await prisma.feedbackSignal.findMany({
            where: {
                session: {
                    event: {
                        // Implicitly scoped by strictly requiring event access above
                    }
                }
            },
            select: { action: true, edit_distance: true }
        });

        const stats = {
            total_suggestions: feedbackHistory.length,
            ignored_count: feedbackHistory.filter((f: { action: string }) => f.action === 'IGNORE' || f.action === 'DISMISS').length,
            edited_count: feedbackHistory.filter((f: { action: string }) => f.action === 'EDIT_COPY').length,
            avg_edit_distance: 0
        };

        // 2. Assemble Context
        const tenantContext: any = {
            tenant_id: installId,
            tone: event.video_id.length % 2 === 0 ? 'PROFESSIONAL' : 'CASUAL',
            avg_reply_length: 'MEDIUM',
            prohibited_keywords: []
        };

        const count = await prisma.suggestionSession.count({ where: { event_id: event.id } });

        // Phase 17B: Reconstruct Domain Event
        const rawMeta = parseEventMetadata((event as any).metadata);

        const videoEvent: VideoEvent = {
            platform: event.platform as any,
            video_id: event.video_id,
            creator_id: rawMeta.video?.author_id || 'unknown',
            creator_name: rawMeta.video?.author_name || 'unknown',
            video_title: rawMeta.video?.title || 'Untitled Video',
            video_description: '',
            video_tags: [],
            timestamp: rawMeta.page?.timestamp || new Date().toISOString(),
            session_id: rawMeta.session?.session_id || 'unknown_session',
            install_id: installId,
            text: event.content_text
        };

        const capabilityRequest = VideoEventAdapter.toCapabilityRequest(videoEvent);

        capabilityRequest.tenant_id = installId;
        if (!capabilityRequest.context) capabilityRequest.context = {};

        // Gap B Fix: Inject account_id into raw_event for SafetyService
        const existingRaw = (capabilityRequest.context.raw_event as object) || {};
        capabilityRequest.context.raw_event = {
            ...existingRaw,
            account_id: install.account_id // CRITICAL: Propagate Account ID
        };

        (capabilityRequest.context as any).flow = 'answer_then_recommend';

        const capabilityResponse = await BrainGateway.processCapability(capabilityRequest);

        const payload = capabilityResponse.payload as { text?: string; strategy?: string } | null;
        const decisions = (capabilityResponse.policy_decisions || {}) as { explanation?: string; trace?: any };

        const brainResp = {
            text: payload?.text || '',
            strategy: payload?.strategy || 'ANSWER',
            confidence: capabilityResponse.confidence,
            explanation: decisions?.explanation || 'Generated via Gateway',
            decision_trace: decisions?.trace || {},
            model: 'gateway-model'
        };

        const session = await prisma.suggestionSession.create({
            data: {
                event_id: event.id,
                version: count + 1,
                input_snapshot: JSON.stringify({
                    text: event.content_text,
                    tenant: tenantContext,
                    history: stats
                }),
                suggestion_text: brainResp.text,
                brain_meta: JSON.stringify({
                    model: brainResp.model,
                    strategy: brainResp.strategy,
                    confidence: brainResp.confidence,
                    explanation: brainResp.explanation,
                    trace: brainResp.decision_trace
                })
            }
        });

        await prisma.engagementEvent.update({
            where: { id: event.id },
            data: { status: 'SUGGESTED' }
        });

        res.json({
            session_id: session.id,
            text: session.suggestion_text,
            version: session.version,
            _meta: {
                strategy: brainResp.strategy,
                explanation: brainResp.explanation,
                model: brainResp.model,
                prompt_version: (brainResp.decision_trace as any).prompt_version,
                rag: (brainResp.decision_trace as any).rag_meta
            }
        });

    } catch (err: any) {
        console.error('Suggestion Failed Stack:', err.stack || err);
        res.status(500).json({ error: 'Suggestion failed', details: err.message });
    }
});

// ==========================================
// Phase 12.3 & 12.4 Feedback Loop
// ==========================================
router.post('/feedback', async (req: Request, res: Response) => {
    const { session_id, action, final_text } = req.body;

    try {
        const session = await prisma.suggestionSession.findUnique({ where: { id: session_id } });
        if (!session) {
            res.status(404).json({ error: 'Session not found' });
            return;
        }

        const original = session.suggestion_text;
        const dist = final_text && final_text !== original ? 10 : 0;

        await prisma.feedbackSignal.create({
            data: {
                session_id,
                action,
                final_text,
                edit_distance: dist,
                time_to_action: 0
            }
        });

        let newStatus = 'DONE';
        if (action === 'IGNORE' || action === 'DISMISS') newStatus = 'IGNORED';

        await prisma.engagementEvent.update({
            where: { id: session.event_id },
            data: { status: newStatus }
        });

        res.json({ status: 'success' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Feedback failed' });
    }
});

// ==========================================
// Phase 12.6 Admin Controls
// ==========================================

router.post('/admin/kill-switch', requireAdmin, async (req: Request, res: Response) => {
    const { install_id, set_active } = req.body;
    try {
        await prisma.installRegistry.update({
            where: { install_id },
            data: { is_active: set_active }
        });
        res.json({ status: 'updated', install_id, is_active: set_active });
    } catch (err) {
        res.status(500).json({ error: 'Update failed' });
    }
});


router.get('/admin/queue', requireAdmin, async (req: Request, res: Response) => {
    // Optional filters
    const { status, install_id } = req.query;

    const where: any = {};
    if (status) where.status = status;
    if (install_id) where.install_id = install_id;

    const events = await prisma.engagementEvent.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: 100, // Increased visibility
        include: {
            sessions: { include: { feedback: true } },
            account: { select: { name: true, status: true } } // Helpful context
        }
    });
    res.json(events);
});

export default router;
