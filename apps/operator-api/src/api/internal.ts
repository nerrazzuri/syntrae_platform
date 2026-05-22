import { Router, Request, Response } from 'express';
import { requireInternalSecret } from '../middleware/internal_auth';
import { prisma } from '../db';
import { randomUUID } from 'crypto';
import { OwnerSettingsService } from '../services/owner/owner_settings_service';
import { MarketProfileService } from '../services/market_profile.service';
import { LeadQuotaService } from '../services/billing/lead_quota.service';
import { PolicyService } from '../services/policy.service';
import { SubscriptionPolicyService } from '../services/billing/subscription_policy.service';
import {
    closeReplyWatch,
    createReplyWatchForSentDraft,
    expireReplyWatches,
    listDueReplyWatches,
    markReplyWatchChecked,
    markReplyWatchUserReplied,
} from '../services/replyWatch.service';
import {
    getDraftFeedbackSummary,
    listDraftFeedbackForDraft,
    recordDraftFeedback,
} from '../services/draftFeedback.service';
import {
    buildFeedbackRecommendations,
    getDraftFeedbackInsights,
} from '../services/draftFeedbackInsight.service';
import {
    generateLearningSuggestions,
    listLearningSuggestions,
    updateLearningSuggestionStatus,
} from '../services/learningSuggestion.service';

const router = Router();
const DEFAULT_LEASE_SECONDS = 120;
const MIN_LEASE_SECONDS = 30;
const MAX_LEASE_SECONDS = 900;
const DEFAULT_STALE_MINUTES = 10;
const DEFAULT_RETRY_DELAY_SECONDS = 30;
const DEFAULT_SWEEP_LIMIT = 25;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_AUTOMATION_INSTALL_SECRET =
    process.env.AI_ENGAGEMENT_INTERNAL_SECRET ||
    process.env.AI_CORE_INTERNAL_SECRET ||
    'secret';

// Apply internal secret auth to all routes in this router
router.use(requireInternalSecret);

function resolveLeaseSeconds(rawValue: unknown) {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
        return DEFAULT_LEASE_SECONDS;
    }

    return Math.max(MIN_LEASE_SECONDS, Math.min(MAX_LEASE_SECONDS, Math.floor(parsed)));
}

function resolvePositiveInteger(rawValue: unknown, fallback: number, min: number, max: number) {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function accountScopeFromRequest(req: Request): string | undefined {
    const header = req.headers['x-account-id'];
    if (Array.isArray(header)) return header[0];
    return header || undefined;
}

async function ensureWorkspaceAutomationInstall(workspaceId: string) {
    const installId = `automation-${workspaceId}`;

    return prisma.installRegistry.upsert({
        where: { install_id: installId },
        update: {
            account_id: workspaceId,
            install_secret: DEFAULT_AUTOMATION_INSTALL_SECRET,
            is_active: true,
        },
        create: {
            install_id: installId,
            account_id: workspaceId,
            install_secret: DEFAULT_AUTOMATION_INSTALL_SECRET,
            is_active: true,
        },
        select: {
            install_id: true,
            install_secret: true,
        },
    });
}

// GET /internal/automation-policy/latest
router.get('/automation-policy/latest', async (req: Request, res: Response) => {
    try {
        const brandId = req.query.brand_id as string;
        if (!brandId) return res.status(400).json({ error: "Missing brand_id" });

        let policy = await prisma.automationPolicy.findFirst({
            where: {
                brand_id: brandId,
                status: { not: 'ARCHIVED' }
            },
            orderBy: { version: 'desc' }
        });

        if (!policy) {
            policy = await PolicyService.createDefaultPolicy(brandId);
        }
        return res.json(policy);
    } catch (e: any) {
        return res.status(500).json({ error: e.message });
    }
});

// GET /internal/market-profile/latest
router.get('/market-profile/latest', async (req: Request, res: Response) => {
    try {
        const brandId = req.query.brand_id as string;
        if (!brandId) return res.status(400).json({ error: "Missing brand_id" });

        const profile = await MarketProfileService.getOrCreateActiveProfile(brandId);
        return res.json(profile);
    } catch (e: any) {
        return res.status(500).json({ error: e.message });
    }
});

// POST /internal/automation-run
// ATOMIC: Created only if inputs are valid and persisted with snapshot
router.post('/automation-run', async (req: Request, res: Response) => {
    const { brand_id, install_id, platform, discovery_mode, policy_snapshot, market_profile_snapshot } = req.body;

    if (!brand_id || !install_id || !policy_snapshot) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    // Validate Snapshot Integrity (Basic check)
    // WF-1 requires market_profile_snapshot if discovery relies on it, but we won't strictly enforce existence for manual mode here,
    // Just enforce that if we create a run, we persist what was given.
    // However, the caller should ensure market_profile_snapshot is passed.

    try {
        const run = await prisma.automationRun.create({
            data: {
                brand_id,
                install_id,
                platform: platform || 'tiktok',
                discovery_mode: discovery_mode || 'MANUAL_URL',
                status: 'RUNNING',
                policy_snapshot: policy_snapshot,
                market_profile_snapshot: market_profile_snapshot || null, // Allow null for fallback/legacy but generally expected
                policy_id: policy_snapshot.id, // Link to source if available
            }
        });

        return res.status(201).json(run);
    } catch (e: any) {
        console.error("Failed to create automation run:", e);
        return res.status(500).json({ error: "Failed to persist automation run atomically" });
    }
});

// POST /internal/automation-run/:runId/start
// Attaches execution snapshots to an already claimed queued run.
router.post('/automation-run/:runId/start', async (req: Request, res: Response) => {
    const { runId } = req.params;
    const { claim_token, worker_id, platform, discovery_mode, policy_snapshot, market_profile_snapshot } = req.body;

    if (!claim_token || !worker_id || !policy_snapshot) {
        return res.status(400).json({ error: 'Missing claim_token, worker_id, or policy_snapshot' });
    }

    try {
        const updateResult = await prisma.automationRun.updateMany({
            where: {
                id: runId,
                status: 'RUNNING',
                claim_token,
                claimed_by: worker_id
            },
            data: {
                install_id: worker_id,
                platform: platform || 'tiktok',
                discovery_mode: discovery_mode || 'MANUAL_URL',
                policy_snapshot,
                market_profile_snapshot: market_profile_snapshot || null,
                policy_id: policy_snapshot.id || null
            }
        });

        if (updateResult.count === 0) {
            return res.status(409).json({ error: 'Run claim is not owned by this worker', runId });
        }

        const run = await prisma.automationRun.findUnique({ where: { id: runId } });
        return res.json(run);
    } catch (e: any) {
        console.error(`Failed to start claimed automation run ${runId}:`, e);
        return res.status(500).json({ error: 'Failed to start claimed automation run' });
    }
});

// POST /internal/automation-runs/claim
// Atomically claim the next runnable queue item for a worker.
router.post('/automation-runs/claim', async (req: Request, res: Response) => {
    const workerId = String(req.body?.worker_id || '').trim();
    if (!workerId) {
        return res.status(400).json({ error: 'Missing worker_id' });
    }

    const leaseSeconds = resolveLeaseSeconds(req.body?.lease_seconds);
    const claimToken = randomUUID();

    try {
        const claimed = await prisma.$transaction(async (tx) => {
            const candidates = await tx.$queryRaw<Array<{ id: string }>>`
                SELECT current_run."id"
                FROM "core"."AutomationRun" current_run
                WHERE (
                    (
                        current_run."status" = 'PENDING'::"core"."RunStatus"
                        AND (current_run."next_retry_at" IS NULL OR current_run."next_retry_at" <= NOW())
                    ) OR (
                        current_run."status" = 'RUNNING'::"core"."RunStatus"
                        AND current_run."lease_expires_at" IS NOT NULL
                        AND current_run."lease_expires_at" <= NOW()
                    ) OR (
                        current_run."status" = 'RUNNING'::"core"."RunStatus"
                        AND current_run."lease_expires_at" IS NULL
                        AND current_run."claim_token" IS NULL
                        AND current_run."claimed_by" IS NULL
                        AND current_run."heartbeat_at" IS NULL
                        AND current_run."started_at" <= NOW() - INTERVAL '10 minutes'
                    )
                )
                AND NOT EXISTS (
                    SELECT 1
                    FROM "core"."AutomationRun" active_run
                    WHERE active_run."brand_id" = current_run."brand_id"
                      AND COALESCE(active_run."platform", '') = COALESCE(current_run."platform", '')
                      AND active_run."id" <> current_run."id"
                      AND active_run."status" = 'RUNNING'::"core"."RunStatus"
                      AND (
                          (active_run."lease_expires_at" IS NOT NULL AND active_run."lease_expires_at" > NOW())
                          OR (
                              active_run."lease_expires_at" IS NULL
                              AND active_run."claim_token" IS NULL
                              AND active_run."claimed_by" IS NULL
                              AND active_run."heartbeat_at" IS NULL
                              AND active_run."started_at" > NOW() - INTERVAL '10 minutes'
                          )
                      )
                )
                ORDER BY current_run."started_at" ASC, current_run."id" ASC
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            `;

            const candidate = candidates[0];
            if (!candidate) {
                return null;
            }

            return tx.automationRun.update({
                where: { id: candidate.id },
                data: {
                    status: 'RUNNING',
                    install_id: workerId,
                    claimed_by: workerId,
                    claim_token: claimToken,
                    claimed_at: new Date(),
                    heartbeat_at: new Date(),
                    lease_expires_at: new Date(Date.now() + leaseSeconds * 1000),
                    attempt_count: { increment: 1 },
                    ended_at: null,
                    abort_reason: null,
                    last_error: null
                },
                select: {
                    id: true,
                    brand_id: true,
                    platform: true,
                    discovery_mode: true,
                    install_id: true,
                    claim_token: true,
                    claimed_by: true,
                    lease_expires_at: true,
                    attempt_count: true,
                    started_at: true
                }
            });
        });
        if (!claimed) {
            return res.json(null);
        }

        const brand = await prisma.brand.findUnique({
            where: { id: claimed.brand_id },
            select: { workspace_id: true }
        });
        const planSummary = brand?.workspace_id
            ? await SubscriptionPolicyService.getWorkspacePlanSummary(brand.workspace_id)
            : null;
        const automationInstall = brand?.workspace_id
            ? await ensureWorkspaceAutomationInstall(brand.workspace_id)
            : null;

        return res.json({
            ...claimed,
            workspace_id: brand?.workspace_id || null,
            workspace_plan_code: planSummary?.plan_code || null,
            ingestion_install_id: automationInstall?.install_id || null,
            ingestion_install_secret: automationInstall?.install_secret || null,
        });
    } catch (e: any) {
        console.error('Failed to claim automation run:', e);
        return res.status(500).json({ error: 'Failed to claim automation run' });
    }
});

router.post('/automation-videos/check-eligibility', async (req: Request, res: Response) => {
    const brandId = String(req.body?.brand_id || '').trim();
    const platform = String(req.body?.platform || '').trim();
    const videoId = String(req.body?.video_id || '').trim();

    if (!brandId || !platform || !videoId) {
        return res.status(400).json({ error: 'Missing brand_id, platform, or video_id' });
    }

    try {
        const brand = await prisma.brand.findUnique({
            where: { id: brandId },
            select: { id: true, workspace_id: true }
        });

        if (!brand) {
            return res.status(404).json({ error: 'Brand not found' });
        }

        const settings = await OwnerSettingsService.getSettings(brand.workspace_id);
        const cooldownHours = Math.max(settings.cooldown_hours || 0, 0);
        if (cooldownHours <= 0) {
            return res.json({
                eligible: true,
                workspace_id: brand.workspace_id,
                cooldown_hours: cooldownHours
            });
        }

        const cutoff = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);
        const latestDiscoveredVideo = await prisma.discoveredVideo.findFirst({
            where: {
                brand_id: brandId,
                platform,
                video_id: videoId,
                discovered_at: { gte: cutoff }
            },
            orderBy: { discovered_at: 'desc' },
            select: {
                id: true,
                discovered_at: true,
                automation_run_id: true
            }
        });

        if (latestDiscoveredVideo) {
            const cooldownUntil = new Date(latestDiscoveredVideo.discovered_at.getTime() + cooldownHours * 60 * 60 * 1000);
            return res.json({
                eligible: false,
                workspace_id: brand.workspace_id,
                cooldown_hours: cooldownHours,
                reason: 'VIDEO_COOLDOWN_ACTIVE',
                existing_discovery_id: latestDiscoveredVideo.id,
                last_processed_at: latestDiscoveredVideo.discovered_at,
                cooldown_until: cooldownUntil
            });
        }

        const latestEvent = await prisma.engagementEvent.findFirst({
            where: {
                account_id: brand.workspace_id,
                platform,
                video_id: videoId,
                created_at: { gte: cutoff }
            },
            orderBy: { created_at: 'desc' },
            select: {
                id: true,
                created_at: true
            }
        });

        if (!latestEvent) {
            return res.json({
                eligible: true,
                workspace_id: brand.workspace_id,
                cooldown_hours: cooldownHours
            });
        }

        const cooldownUntil = new Date(latestEvent.created_at.getTime() + cooldownHours * 60 * 60 * 1000);
        return res.json({
            eligible: false,
            workspace_id: brand.workspace_id,
            cooldown_hours: cooldownHours,
            reason: 'VIDEO_COOLDOWN_ACTIVE',
            existing_event_id: latestEvent.id,
            last_processed_at: latestEvent.created_at,
            cooldown_until: cooldownUntil
        });
    } catch (e: any) {
        console.error('Failed to check automation video eligibility:', e);
        return res.status(500).json({ error: 'Failed to check automation video eligibility' });
    }
});

router.post('/billing/lead-quota/reserve', async (req: Request, res: Response) => {
    const workspaceId = String(req.body?.workspace_id || '').trim();
    if (!workspaceId) {
        return res.status(400).json({ error: 'Missing workspace_id' });
    }

    try {
        const result = await LeadQuotaService.reserveLeadCapacity(workspaceId);
        if (!result.allowed) {
            return res.status(402).json(result);
        }
        return res.json(result);
    } catch (e: any) {
        console.error('Failed to reserve lead quota capacity:', e);
        return res.status(500).json({ error: 'Failed to reserve lead quota capacity' });
    }
});

router.post('/drafts/:id/feedback', async (req: Request, res: Response) => {
    try {
        const feedback = await recordDraftFeedback({
            accountId: accountScopeFromRequest(req) || req.body?.account_id,
            outreachDraftId: req.params.id,
            feedbackType: req.body?.feedback_type || req.body?.feedbackType,
            humanEditedText: req.body?.human_edited_text || req.body?.humanEditedText,
            feedbackNote: req.body?.feedback_note || req.body?.feedbackNote,
            selectedReasons: req.body?.selected_reasons || req.body?.selectedReasons,
            finalSentText: req.body?.final_sent_text || req.body?.finalSentText,
            metadata: req.body?.metadata,
        });
        return res.status(201).json({ feedback });
    } catch (e: any) {
        const message = String(e?.message || 'Failed to record draft feedback');
        const status = message.includes('not found')
            ? 404
            : message.includes('scope mismatch')
                ? 403
                : message.includes('Invalid') || message.includes('required') || message.includes('array')
                    ? 400
                    : 500;
        console.error(`Failed to record feedback for draft ${req.params.id}:`, e);
        return res.status(status).json({ error: message });
    }
});

router.get('/drafts/:id/feedback', async (req: Request, res: Response) => {
    try {
        const feedback = await listDraftFeedbackForDraft({
            accountId: accountScopeFromRequest(req) || String(req.query.account_id || ''),
            outreachDraftId: req.params.id,
        });
        return res.json({ feedback });
    } catch (e: any) {
        const message = String(e?.message || 'Failed to list draft feedback');
        const status = message.includes('required') ? 400 : 500;
        console.error(`Failed to list feedback for draft ${req.params.id}:`, e);
        return res.status(status).json({ error: message });
    }
});

router.get('/feedback/summary', async (req: Request, res: Response) => {
    try {
        const summary = await getDraftFeedbackSummary({
            accountId: accountScopeFromRequest(req) || String(req.query.account_id || ''),
            brandId: String(req.query.brand_id || ''),
        });
        return res.json(summary);
    } catch (e: any) {
        console.error('Failed to summarize draft feedback:', e);
        return res.status(500).json({ error: 'Failed to summarize draft feedback' });
    }
});

router.get('/feedback/insights', async (req: Request, res: Response) => {
    try {
        const insights = await getDraftFeedbackInsights({
            accountId: accountScopeFromRequest(req) || String(req.query.account_id || ''),
            brandId: String(req.query.brand_id || ''),
            platform: String(req.query.platform || ''),
            from: String(req.query.from || ''),
            to: String(req.query.to || ''),
            limitExamples: Number(req.query.limit_examples || ''),
        });
        return res.json({
            insights,
            recommendations: buildFeedbackRecommendations(insights),
        });
    } catch (e: any) {
        console.error('Failed to build draft feedback insights:', e);
        return res.status(500).json({ error: 'Failed to build draft feedback insights' });
    }
});

router.post('/learning-suggestions/generate', async (req: Request, res: Response) => {
    try {
        const result = await generateLearningSuggestions({
            accountId: accountScopeFromRequest(req) || req.body?.account_id,
            brandId: req.body?.brand_id,
            platform: req.body?.platform,
            from: req.body?.from,
            to: req.body?.to,
            dryRun: req.body?.dry_run !== false,
        });
        return res.json(result);
    } catch (e: any) {
        const message = String(e?.message || 'Failed to generate learning suggestions');
        const status = message.includes('required') ? 400 : 500;
        console.error('Failed to generate learning suggestions:', e);
        return res.status(status).json({ error: message });
    }
});

router.get('/learning-suggestions', async (req: Request, res: Response) => {
    try {
        const suggestions = await listLearningSuggestions({
            accountId: accountScopeFromRequest(req) || String(req.query.account_id || ''),
            brandId: String(req.query.brand_id || ''),
            platform: String(req.query.platform || ''),
            status: String(req.query.status || ''),
            suggestionType: String(req.query.suggestion_type || ''),
            limit: Number(req.query.limit || ''),
        });
        return res.json({ suggestions });
    } catch (e: any) {
        const message = String(e?.message || 'Failed to list learning suggestions');
        const status = message.includes('required') || message.includes('Invalid') ? 400 : 500;
        console.error('Failed to list learning suggestions:', e);
        return res.status(status).json({ error: message });
    }
});

router.post('/learning-suggestions/:id/status', async (req: Request, res: Response) => {
    try {
        const suggestion = await updateLearningSuggestionStatus({
            accountId: accountScopeFromRequest(req) || req.body?.account_id,
            suggestionId: req.params.id,
            status: req.body?.status,
            reviewedBy: req.body?.reviewed_by,
            reviewNote: req.body?.review_note,
        });
        return res.json({ suggestion });
    } catch (e: any) {
        const message = String(e?.message || 'Failed to update learning suggestion status');
        const status = message.includes('not found')
            ? 404
            : message.includes('scope mismatch')
                ? 403
                : message.includes('required') || message.includes('Invalid')
                    ? 400
                    : 500;
        console.error(`Failed to update learning suggestion ${req.params.id}:`, e);
        return res.status(status).json({ error: message });
    }
});

router.post('/reply-watches/from-sent-draft', async (req: Request, res: Response) => {
    const outreachDraftId = String(req.body?.outreach_draft_id || req.body?.outreachDraftId || '').trim();
    if (!outreachDraftId) {
        return res.status(400).json({ error: 'Missing outreach_draft_id' });
    }

    try {
        const watch = await createReplyWatchForSentDraft({
            outreachDraftId,
            sentAt: req.body?.sent_at,
            platform: req.body?.platform,
            sourcePostId: req.body?.source_post_id,
            sourceCommentId: req.body?.source_comment_id,
            parentCommentId: req.body?.parent_comment_id,
            threadKey: req.body?.thread_key,
            metadata: {
                ...(req.body?.metadata || {}),
                ...(req.body?.platform_reply_id ? { platform_reply_id: req.body.platform_reply_id } : {}),
            },
        });

        return res.status(watch ? 201 : 200).json({ watch });
    } catch (e: any) {
        console.error('Failed to create ReplyWatch from sent draft:', e);
        return res.status(500).json({ error: 'Failed to create ReplyWatch' });
    }
});

router.get('/reply-watches/due', async (req: Request, res: Response) => {
    try {
        const watches = await listDueReplyWatches({
            limit: resolvePositiveInteger(req.query.limit, 50, 1, 200),
        });
        return res.json({ watches });
    } catch (e: any) {
        console.error('Failed to list due ReplyWatch records:', e);
        return res.status(500).json({ error: 'Failed to list due ReplyWatch records' });
    }
});

router.post('/reply-watches/expire', async (req: Request, res: Response) => {
    try {
        const expired = await expireReplyWatches({
            now: req.body?.now ? new Date(req.body.now) : undefined,
        });
        return res.json({ expired });
    } catch (e: any) {
        console.error('Failed to expire ReplyWatch records:', e);
        return res.status(500).json({ error: 'Failed to expire ReplyWatch records' });
    }
});

router.post('/reply-watches/:id/checked', async (req: Request, res: Response) => {
    try {
        const watch = await markReplyWatchChecked({
            id: req.params.id,
            checkedAt: req.body?.checked_at,
            lastSeenReplyId: req.body?.last_seen_reply_id,
        });
        return res.json({ watch });
    } catch (e: any) {
        console.error(`Failed to mark ReplyWatch ${req.params.id} checked:`, e);
        return res.status(500).json({ error: 'Failed to mark ReplyWatch checked' });
    }
});

router.post('/reply-watches/:id/user-replied', async (req: Request, res: Response) => {
    try {
        const watch = await markReplyWatchUserReplied({
            id: req.params.id,
            replyId: req.body?.reply_id,
            repliedAt: req.body?.replied_at,
            engagementEventId: req.body?.engagement_event_id,
            metadata: req.body?.metadata,
        });
        return res.json({ watch });
    } catch (e: any) {
        console.error(`Failed to mark ReplyWatch ${req.params.id} user replied:`, e);
        return res.status(500).json({ error: 'Failed to mark ReplyWatch user replied' });
    }
});

router.post('/reply-watches/:id/close', async (req: Request, res: Response) => {
    try {
        const watch = await closeReplyWatch({
            id: req.params.id,
            closedAt: req.body?.closed_at,
        });
        return res.json({ watch });
    } catch (e: any) {
        console.error(`Failed to close ReplyWatch ${req.params.id}:`, e);
        return res.status(500).json({ error: 'Failed to close ReplyWatch' });
    }
});

// POST /internal/automation-runs/sweep-stale
// Requeues or fails stale runs so long-lived worker crashes do not leave them stuck forever.
router.post('/automation-runs/sweep-stale', async (req: Request, res: Response) => {
    const staleMinutes = resolvePositiveInteger(req.body?.stale_minutes, DEFAULT_STALE_MINUTES, 1, 1440);
    const retryDelaySeconds = resolvePositiveInteger(req.body?.retry_delay_seconds, DEFAULT_RETRY_DELAY_SECONDS, 0, 3600);
    const maxAttempts = resolvePositiveInteger(req.body?.max_attempts, DEFAULT_MAX_ATTEMPTS, 1, 20);
    const limit = resolvePositiveInteger(req.body?.limit, DEFAULT_SWEEP_LIMIT, 1, 200);

    try {
        const result = await prisma.$transaction(async (tx) => {
            const staleRuns = await tx.$queryRaw<Array<{ id: string; attempt_count: number }>>`
                SELECT "id", "attempt_count"
                FROM "core"."AutomationRun"
                WHERE (
                    "status" = 'RUNNING'::"core"."RunStatus"
                    AND "lease_expires_at" IS NOT NULL
                    AND "lease_expires_at" <= NOW()
                ) OR (
                    "status" = 'RUNNING'::"core"."RunStatus"
                    AND "lease_expires_at" IS NULL
                    AND "claim_token" IS NULL
                    AND "claimed_by" IS NULL
                    AND "heartbeat_at" IS NULL
                    AND "started_at" <= NOW() - (${staleMinutes} * INTERVAL '1 minute')
                )
                ORDER BY "started_at" ASC, "id" ASC
                LIMIT ${limit}
                FOR UPDATE SKIP LOCKED
            `;

            const summary = {
                scanned: staleRuns.length,
                requeued: 0,
                failed: 0,
                requeued_ids: [] as string[],
                failed_ids: [] as string[]
            };

            for (const run of staleRuns) {
                const exhausted = (run.attempt_count || 0) >= maxAttempts;

                await tx.automationRun.update({
                    where: { id: run.id },
                    data: exhausted ? {
                        status: 'FAILED',
                        ended_at: new Date(),
                        abort_reason: 'STALE_RUN_MAX_ATTEMPTS',
                        last_error: 'STALE_RUN_MAX_ATTEMPTS',
                        claimed_by: null,
                        claim_token: null,
                        claimed_at: null,
                        heartbeat_at: null,
                        lease_expires_at: null,
                        next_retry_at: null
                    } : {
                        status: 'PENDING',
                        ended_at: null,
                        abort_reason: null,
                        last_error: 'STALE_RUN_REQUEUED',
                        claimed_by: null,
                        claim_token: null,
                        claimed_at: null,
                        heartbeat_at: null,
                        lease_expires_at: null,
                        next_retry_at: new Date(Date.now() + retryDelaySeconds * 1000)
                    }
                });

                if (exhausted) {
                    summary.failed += 1;
                    summary.failed_ids.push(run.id);
                } else {
                    summary.requeued += 1;
                    summary.requeued_ids.push(run.id);
                }
            }

            return summary;
        });

        return res.json(result);
    } catch (e: any) {
        console.error('Failed to sweep stale automation runs:', e);
        return res.status(500).json({ error: 'Failed to sweep stale automation runs' });
    }
});

// GET /internal/automation-run/:runId
// WF-3: Fetch run snapshot for market scoring
router.get('/automation-run/:runId', async (req: Request, res: Response) => {
    const { runId } = req.params;

    try {
        const run = await prisma.automationRun.findUnique({
            where: { id: runId },
            select: {
                id: true,
                brand_id: true,
                install_id: true,
                platform: true,
                discovery_mode: true,
                status: true,
                policy_snapshot: true,
                market_profile_snapshot: true,
                started_at: true
            }
        });

        // WF-3 Error Semantics (Locked)
        if (!run) {
            return res.status(404).json({ error: "Run not found", runId });
        }

        if (!run.market_profile_snapshot) {
            // WF-1 contract violation: run exists but missing snapshot
            return res.status(409).json({
                error: "WF-1 contract violation: market_profile_snapshot missing",
                runId
            });
        }

        // Validate snapshot is parseable JSON
        try {
            JSON.parse(JSON.stringify(run.market_profile_snapshot));
        } catch {
            return res.status(422).json({
                error: "Data corruption: market_profile_snapshot malformed",
                runId
            });
        }

        return res.json(run);
    } catch (e: any) {
        console.error(`Failed to fetch run ${runId}:`, e);
        return res.status(500).json({ error: "Internal server error" });
    }
});

// PATCH /internal/automation-run/:runId/status
// WF-3.1: Update run status for systemic failures
router.patch('/automation-run/:runId/status', async (req: Request, res: Response) => {
    const { runId } = req.params;
    const { status, abort_reason, claim_token, worker_id, next_retry_at } = req.body;

    if (!status) {
        return res.status(400).json({ error: "Missing status" });
    }

    // Validate status is a known value
    const validStatuses = ['PENDING', 'RUNNING', 'COMPLETED', 'DEGRADED', 'HOURLY_QUOTA_EXHAUSTED', 'ABORTED', 'FAILED'];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: `Invalid status: ${status}` });
    }

    try {
        const terminal = ['COMPLETED', 'DEGRADED', 'HOURLY_QUOTA_EXHAUSTED', 'FAILED', 'ABORTED'].includes(status);
        const updateWhere: any = { id: runId };

        if (claim_token) {
            updateWhere.claim_token = claim_token;
        }

        if (worker_id) {
            updateWhere.claimed_by = worker_id;
        }

        const updateResult = await prisma.automationRun.updateMany({
            where: updateWhere,
            data: {
                status,
                abort_reason: abort_reason || null,
                last_error: abort_reason || null,
                next_retry_at: next_retry_at ? new Date(next_retry_at) : null,
                ended_at: terminal ? new Date() : null,
                heartbeat_at: terminal ? new Date() : undefined,
                lease_expires_at: terminal ? null : undefined,
                claim_token: terminal ? null : undefined,
                claimed_by: terminal ? null : undefined,
                claimed_at: terminal ? null : undefined
            }
        });

        if (updateResult.count === 0) {
            return res.status(409).json({ error: 'Run claim is not owned by this worker', runId });
        }

        const run = await prisma.automationRun.findUnique({ where: { id: runId } });
        return res.json(run);
    } catch (e: any) {
        console.error(`Failed to update run status ${runId}:`, e);
        if (e.code === 'P2025') {
            return res.status(404).json({ error: "Run not found", runId });
        }
        return res.status(500).json({ error: "Internal server error" });
    }
});

router.patch('/automation-run/:runId/stats', async (req: Request, res: Response) => {
    const { runId } = req.params;
    const { claim_token, worker_id, stats } = req.body;

    if (!stats || typeof stats !== 'object') {
        return res.status(400).json({ error: 'Missing stats payload' });
    }

    try {
        const updateWhere: any = { id: runId };
        if (claim_token) {
            updateWhere.claim_token = claim_token;
        }
        if (worker_id) {
            updateWhere.claimed_by = worker_id;
        }

        const updateResult = await prisma.automationRun.updateMany({
            where: updateWhere,
            data: {
                stats,
                heartbeat_at: new Date()
            }
        });

        if (updateResult.count === 0) {
            return res.status(409).json({ error: 'Run claim is not owned by this worker', runId });
        }

        const run = await prisma.automationRun.findUnique({ where: { id: runId } });
        return res.json(run);
    } catch (e: any) {
        console.error(`Failed to update run stats ${runId}:`, e);
        if (e.code === 'P2025') {
            return res.status(404).json({ error: 'Run not found', runId });
        }
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// POST /internal/automation-run/:runId/heartbeat
// Extends the current lease for a claimed queue item.
router.post('/automation-run/:runId/heartbeat', async (req: Request, res: Response) => {
    const { runId } = req.params;
    const claimToken = String(req.body?.claim_token || '').trim();
    const workerId = String(req.body?.worker_id || '').trim();

    if (!claimToken || !workerId) {
        return res.status(400).json({ error: 'Missing claim_token or worker_id' });
    }

    const leaseSeconds = resolveLeaseSeconds(req.body?.lease_seconds);

    try {
        const updated = await prisma.automationRun.updateMany({
            where: {
                id: runId,
                status: 'RUNNING',
                claim_token: claimToken,
                claimed_by: workerId
            },
            data: {
                heartbeat_at: new Date(),
                lease_expires_at: new Date(Date.now() + leaseSeconds * 1000)
            }
        });

        if (updated.count === 0) {
            return res.status(409).json({ error: 'Lease is no longer owned by this worker', runId });
        }

        const run = await prisma.automationRun.findUnique({
            where: { id: runId },
            select: {
                id: true,
                status: true,
                claimed_by: true,
                heartbeat_at: true,
                lease_expires_at: true
            }
        });

        return res.json(run);
    } catch (e: any) {
        console.error(`Failed to heartbeat run ${runId}:`, e);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export const internalRouter = router;
