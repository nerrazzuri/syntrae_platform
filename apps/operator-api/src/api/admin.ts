import { Router } from 'express';
import { randomBytes } from 'crypto';
import { prisma } from '../db';
import { AdminAuthService } from '../services/admin_auth.service';
import { requireAdmin } from '../middleware/admin_auth';

const router = Router();

function serializeAdmin(admin: any) {
    return {
        id: admin.id,
        email: admin.email,
        role: admin.role,
        created_at: admin.created_at,
    };
}

router.post('/auth/login', async (req, res) => {
    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        const password = String(req.body?.password || '');
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        const result = await AdminAuthService.login(email, password);
        if (!result) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        res.json({
            token: result.token,
            expires_at: result.expires_at,
            admin: serializeAdmin(result.admin),
        });
    } catch (error) {
        console.error('[Admin] Login failed:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

router.get('/auth/me', requireAdmin, async (req, res) => {
    res.json({ admin: serializeAdmin(req.admin) });
});

router.post('/auth/logout', requireAdmin, async (req, res) => {
    const token = String(req.headers['x-admin-token'] || '').trim();
    await AdminAuthService.logout(token);
    res.json({ status: 'ok' });
});

router.get('/dashboard', requireAdmin, async (_req, res) => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const [
        workspace_count,
        user_count,
        active_brand_count,
        active_connection_count,
        pending_run_count,
        running_run_count,
        lead_count,
        draft_count,
        runs_today,
        comments_captured_today,
        leads_today,
        drafts_today,
        drafts_approved_today,
        drafts_sent_today,
        blocked_events_today,
        recent_runs,
        recent_workspaces,
    ] = await Promise.all([
        prisma.account.count(),
        prisma.user.count(),
        prisma.brand.count({ where: { status: 'ACTIVE' } }),
        prisma.brandPlatformConnection.count({ where: { status: 'CONNECTED' } }),
        prisma.automationRun.count({ where: { status: 'PENDING' } }),
        prisma.automationRun.count({ where: { status: 'RUNNING' } }),
        prisma.leadOpportunity.count(),
        prisma.outreachDraft.count(),
        prisma.automationRun.count({ where: { started_at: { gte: startOfToday } } }),
        prisma.automationRun.findMany({
            where: { started_at: { gte: startOfToday } },
            select: { stats: true }
        }).then((items) => items.reduce((sum, item) => sum + Number((item.stats as any)?.comments_captured || 0), 0)),
        prisma.leadOpportunity.count({ where: { created_at: { gte: startOfToday } } }),
        prisma.outreachDraft.count({ where: { created_at: { gte: startOfToday } } }),
        prisma.outreachDraft.count({ where: { approved_at: { gte: startOfToday } } }),
        prisma.outreachDraft.count({ where: { sent_at: { gte: startOfToday } } }),
        prisma.workspaceUsageCounter.count({ where: { blocked_at: { gte: startOfToday } } }),
        prisma.automationRun.findMany({
            take: 8,
            orderBy: { started_at: 'desc' },
            select: {
                id: true,
                brand_id: true,
                install_id: true,
                status: true,
                started_at: true,
                ended_at: true,
                stats: true,
            }
        }),
        prisma.account.findMany({
            take: 8,
            orderBy: { created_at: 'desc' },
            select: {
                id: true,
                name: true,
                status: true,
                plan_id: true,
                onboarding_state: true,
                created_at: true,
            }
        })
    ]);

    res.json({
        metrics: {
            workspace_count,
            user_count,
            active_brand_count,
            active_connection_count,
            pending_run_count,
            running_run_count,
            lead_count,
            draft_count,
            runs_today,
            comments_captured_today,
            leads_today,
            drafts_today,
            drafts_approved_today,
            drafts_sent_today,
            blocked_events_today,
        },
        recent_runs,
        recent_workspaces,
    });
});

router.get('/workspaces', requireAdmin, async (req, res) => {
    const q = String(req.query.q || '').trim();
    const workspaces = await prisma.account.findMany({
        where: q ? {
            OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { memberships: { some: { user: { email: { contains: q, mode: 'insensitive' } } } } },
                { brands: { some: { name: { contains: q, mode: 'insensitive' } } } },
            ]
        } : undefined,
        orderBy: { created_at: 'desc' },
        take: 100,
        include: {
            subscription: true,
            owner_settings: true,
            _count: {
                select: {
                    memberships: true,
                    brands: true,
                    events: true,
                    leads: true,
                    suggestions: true,
                    installs: true,
                    usage_counters: true,
                    platform_connections: true,
                }
            },
            memberships: {
                take: 3,
                orderBy: { created_at: 'asc' },
                include: {
                    user: {
                        select: { id: true, email: true, status: true, email_verified_at: true }
                    }
                }
            },
            brands: {
                take: 5,
                orderBy: { created_at: 'asc' },
                select: { id: true, name: true, domain: true, status: true }
            },
            platform_connections: {
                take: 8,
                orderBy: { updated_at: 'desc' },
                select: {
                    id: true,
                    brand_id: true,
                    platform: true,
                    status: true,
                    last_checked_at: true,
                    last_verified_at: true,
                    last_error: true,
                    verification_error: true,
                    expires_at: true,
                    updated_at: true,
                }
            },
            usage_counters: {
                take: 12,
                orderBy: { period_start: 'desc' },
                select: {
                    id: true,
                    brand_id: true,
                    scope_key: true,
                    metric_code: true,
                    period_type: true,
                    period_start: true,
                    current_value: true,
                    blocked_at: true,
                    block_reason_code: true,
                }
            }
        }
    });
    const workspaceIds = workspaces.map((workspace) => workspace.id);
    const brandIds = workspaces.flatMap((workspace) => workspace.brands.map((brand) => brand.id));
    const [latestRuns, latestPolicies, latestProfiles, installs] = await Promise.all([
        brandIds.length
            ? prisma.automationRun.findMany({
                where: { brand_id: { in: brandIds } },
                orderBy: { started_at: 'desc' },
                select: {
                    id: true,
                    brand_id: true,
                    platform: true,
                    status: true,
                    started_at: true,
                    ended_at: true,
                    last_error: true,
                    stats: true,
                }
            })
            : Promise.resolve([]),
        brandIds.length
            ? prisma.automationPolicy.findMany({
                where: { brand_id: { in: brandIds } },
                orderBy: [{ updated_at: 'desc' }, { version: 'desc' }],
                select: {
                    id: true,
                    brand_id: true,
                    status: true,
                    version: true,
                    mode: true,
                    enabled: true,
                    max_videos_per_hour: true,
                    max_comments_per_video: true,
                    max_comments_per_hour: true,
                    max_leads_per_day: true,
                    updated_at: true,
                }
            })
            : Promise.resolve([]),
        brandIds.length
            ? prisma.marketProfile.findMany({
                where: { brand_id: { in: brandIds } },
                orderBy: [{ updated_at: 'desc' }, { version: 'desc' }],
                select: {
                    id: true,
                    brand_id: true,
                    name: true,
                    version: true,
                    status: true,
                    primary_category: true,
                    target_audience: true,
                    languages: true,
                    discovery_intent: true,
                    quality_score: true,
                    validation_warnings: true,
                    updated_at: true,
                }
            })
            : Promise.resolve([]),
        workspaceIds.length
            ? prisma.installRegistry.findMany({
                where: { account_id: { in: workspaceIds } },
                select: {
                    id: true,
                    account_id: true,
                    install_id: true,
                    is_active: true,
                    created_at: true,
                }
            })
            : Promise.resolve([]),
    ]);

    const latestRunByBrand = new Map<string, any>();
    latestRuns.forEach((run) => {
        if (!latestRunByBrand.has(run.brand_id)) latestRunByBrand.set(run.brand_id, run);
    });
    const latestPolicyByBrand = new Map<string, any>();
    latestPolicies.forEach((policy) => {
        if (!latestPolicyByBrand.has(policy.brand_id)) latestPolicyByBrand.set(policy.brand_id, policy);
    });
    const latestProfileByBrand = new Map<string, any>();
    latestProfiles.forEach((profile) => {
        if (!latestProfileByBrand.has(profile.brand_id)) latestProfileByBrand.set(profile.brand_id, profile);
    });
    const installsByWorkspace = new Map<string, any[]>();
    installs.forEach((install) => {
        const bucket = installsByWorkspace.get(install.account_id || '') || [];
        bucket.push(install);
        installsByWorkspace.set(install.account_id || '', bucket);
    });

    const items = workspaces.map((workspace) => ({
        ...workspace,
        installs: installsByWorkspace.get(workspace.id) || [],
        brands: workspace.brands.map((brand) => ({
            ...brand,
            latest_run: latestRunByBrand.get(brand.id) || null,
            latest_policy: latestPolicyByBrand.get(brand.id) || null,
            latest_market_profile: latestProfileByBrand.get(brand.id) || null,
        })),
    }));
    res.json({ items });
});

router.get('/users', requireAdmin, async (req, res) => {
    const q = String(req.query.q || '').trim();
    const users = await prisma.user.findMany({
        where: q ? {
            OR: [
                { email: { contains: q, mode: 'insensitive' } },
            ]
        } : undefined,
        orderBy: { created_at: 'desc' },
        take: 100,
        include: {
            memberships: {
                include: {
                    account: {
                        select: { id: true, name: true, status: true, plan_id: true }
                    }
                }
            }
        }
    });
    res.json({ items: users });
});

router.get('/runs', requireAdmin, async (req, res) => {
    const status = String(req.query.status || '').trim();
    const workspaceId = String(req.query.workspace_id || '').trim();
    const runs = await prisma.automationRun.findMany({
        where: {
            ...(status ? { status: status as any } : {}),
            ...(workspaceId ? { brand: { workspace_id: workspaceId } } : {}),
        },
        take: 100,
        orderBy: { started_at: 'desc' },
    });
    const brandIds = Array.from(new Set(runs.map((run) => run.brand_id)));
    const brands = brandIds.length
        ? await prisma.brand.findMany({
            where: { id: { in: brandIds } },
            select: { id: true, name: true, domain: true, workspace_id: true }
        })
        : [];
    const brandMap = new Map(brands.map((brand) => [brand.id, brand]));
    const items = runs.map((run) => ({
        ...run,
        brand: brandMap.get(run.brand_id) ?? null,
    }));
    res.json({ items });
});

router.get('/leads', requireAdmin, async (req, res) => {
    const workspaceId = String(req.query.workspace_id || '').trim();
    const leads = await prisma.leadOpportunity.findMany({
        where: workspaceId ? { account_id: workspaceId } : undefined,
        take: 100,
        orderBy: { created_at: 'desc' },
        include: {
            brand: { select: { id: true, name: true, domain: true } },
            account: { select: { id: true, name: true } },
            event: {
                select: {
                    id: true,
                    platform: true,
                    content_text: true,
                    metadata: true,
                    created_at: true,
                    failure_reason: true,
                    status: true,
                }
            },
            drafts: {
                take: 3,
                orderBy: { created_at: 'desc' },
                select: {
                    id: true,
                    status: true,
                    draft_text: true,
                    edited_text: true,
                    created_at: true,
                    approved_at: true,
                    sent_at: true,
                }
            }
        }
    });
    res.json({ items: leads });
});

router.get('/platform-connections', requireAdmin, async (req, res) => {
    const status = String(req.query.status || '').trim();
    const items = await prisma.brandPlatformConnection.findMany({
        where: status ? { status } : undefined,
        take: 100,
        orderBy: { updated_at: 'desc' },
        include: {
            brand: { select: { id: true, name: true, domain: true } },
            account: { select: { id: true, name: true } },
        }
    });
    const installs = await prisma.installRegistry.findMany({
        where: { account_id: { in: Array.from(new Set(items.map((item) => item.workspace_id))) } },
        select: {
            id: true,
            account_id: true,
            install_id: true,
            install_secret: true,
            is_active: true,
            created_at: true,
        }
    });
    const installsByWorkspace = new Map<string, any[]>();
    installs.forEach((install) => {
        const bucket = installsByWorkspace.get(install.account_id || '') || [];
        bucket.push(install);
        installsByWorkspace.set(install.account_id || '', bucket);
    });
    res.json({
        items: items.map((item) => ({
            ...item,
            installs: installsByWorkspace.get(item.workspace_id) || [],
        }))
    });
});

router.get('/drafts', requireAdmin, async (req, res) => {
    const status = String(req.query.status || '').trim();
    const workspaceId = String(req.query.workspace_id || '').trim();
    const items = await prisma.outreachDraft.findMany({
        where: {
            ...(status ? { status } : {}),
            ...(workspaceId ? { account_id: workspaceId } : {}),
        },
        take: 100,
        orderBy: { created_at: 'desc' },
        include: {
            brand: { select: { id: true, name: true, domain: true } },
            lead: {
                select: {
                    id: true,
                    platform: true,
                    comment_id: true,
                    video_id: true,
                    user_handle: true,
                    intent: true,
                    buyer_stage: true,
                    confidence: true,
                }
            }
        }
    });
    res.json({ items });
});

router.get('/discovery', requireAdmin, async (req, res) => {
    const workspaceId = String(req.query.workspace_id || '').trim();
    const runs = await prisma.automationRun.findMany({
        where: workspaceId ? { brand: { workspace_id: workspaceId } } : undefined,
        take: 60,
        orderBy: { started_at: 'desc' },
        select: {
            id: true,
            brand_id: true,
            platform: true,
            status: true,
            started_at: true,
            ended_at: true,
            last_error: true,
            stats: true,
        }
    });
    const discoveredVideos = await prisma.discoveredVideo.findMany({
        where: {
            ...(workspaceId ? { brand: { workspace_id: workspaceId } } : {}),
            automation_run_id: { in: runs.map((run) => run.id) || [''] },
        },
        take: 300,
        orderBy: { discovered_at: 'desc' },
        select: {
            id: true,
            automation_run_id: true,
            brand_id: true,
            platform: true,
            video_id: true,
            video_url: true,
            market_score: true,
            decision: true,
            decision_reasons: true,
            evaluation_performed: true,
            error_class: true,
            http_status: true,
            discovered_at: true,
        }
    });
    res.json({ runs, discovered_videos: discoveredVideos });
});

router.get('/ai-audit', requireAdmin, async (req, res) => {
    const workspaceId = String(req.query.workspace_id || '').trim();
    const leads = await prisma.leadOpportunity.findMany({
        where: workspaceId ? { account_id: workspaceId } : undefined,
        take: 60,
        orderBy: { created_at: 'desc' },
        include: {
            brand: { select: { id: true, name: true } },
            account: { select: { id: true, name: true } },
            event: {
                select: {
                    id: true,
                    content_text: true,
                    metadata: true,
                    created_at: true,
                    status: true,
                    failure_reason: true,
                }
            },
        }
    });
    const eventIds = leads.map((lead) => lead.source_event_id);
    const sessions = eventIds.length
        ? await prisma.suggestionSession.findMany({
            where: { event_id: { in: eventIds } },
            orderBy: { created_at: 'desc' },
            include: {
                feedback: true,
            }
        })
        : [];
    const sessionMap = new Map<string, any[]>();
    sessions.forEach((session) => {
        const bucket = sessionMap.get(session.event_id) || [];
        bucket.push(session);
        sessionMap.set(session.event_id, bucket);
    });
    res.json({
        items: leads.map((lead) => ({
            ...lead,
            suggestion_sessions: sessionMap.get(lead.source_event_id) || [],
        }))
    });
});

router.get('/policies', requireAdmin, async (req, res) => {
    const workspaceId = String(req.query.workspace_id || '').trim();
    const brands = await prisma.brand.findMany({
        where: workspaceId ? { workspace_id: workspaceId } : undefined,
        take: 100,
        orderBy: { created_at: 'desc' },
        include: {
            account: {
                select: {
                    id: true,
                    name: true,
                    status: true,
                    owner_settings: true,
                }
            },
            platform_connections: {
                take: 5,
                orderBy: { updated_at: 'desc' },
                select: {
                    id: true,
                    platform: true,
                    status: true,
                    last_error: true,
                    expires_at: true,
                    updated_at: true,
                }
            },
            policies: {
                take: 3,
                orderBy: [{ updated_at: 'desc' }, { version: 'desc' }],
            },
            market_profiles: {
                take: 2,
                orderBy: [{ updated_at: 'desc' }, { version: 'desc' }],
            },
            usage_counters: {
                take: 12,
                orderBy: { period_start: 'desc' },
                select: {
                    metric_code: true,
                    current_value: true,
                    period_type: true,
                    period_start: true,
                    blocked_at: true,
                    block_reason_code: true,
                }
            }
        }
    });
    res.json({ items: brands });
});

router.get('/billing', requireAdmin, async (_req, res) => {
    const items = await prisma.account.findMany({
        take: 100,
        orderBy: { created_at: 'desc' },
        include: {
            subscription: true,
            _count: {
                select: {
                    brands: true,
                    installs: true,
                    leads: true,
                }
            },
            usage_counters: {
                take: 20,
                orderBy: { period_start: 'desc' },
                select: {
                    metric_code: true,
                    period_type: true,
                    period_start: true,
                    current_value: true,
                    blocked_at: true,
                    block_reason_code: true,
                }
            }
        }
    });
    res.json({ items });
});

router.post('/workspaces/:id/force-stop-runs', requireAdmin, async (req, res) => {
    const id = req.params.id;
    const brands = await prisma.brand.findMany({
        where: { workspace_id: id },
        select: { id: true }
    });
    const result = await prisma.automationRun.updateMany({
        where: {
            brand_id: { in: brands.map((brand) => brand.id) },
            status: { in: ['PENDING', 'RUNNING'] as any },
        },
        data: {
            status: 'ABORTED',
            abort_reason: 'Admin forced stop',
            ended_at: new Date(),
            last_error: 'Stopped by admin from workspace control plane',
        }
    });
    await prisma.auditLog.create({
        data: {
            actor_id: req.admin!.id,
            actor_type: 'ADMIN',
            action: 'FORCE_STOP_WORKSPACE_RUNS',
            resource: 'AutomationRun',
            resource_id: id,
            workspace_id: id,
            meta: JSON.stringify({ aborted: result.count }),
            ip: req.ip || 'unknown',
        }
    });
    res.json({ status: 'ok', aborted: result.count });
});

router.get('/workspaces/:id/impersonation-preview', requireAdmin, async (req, res) => {
    const id = req.params.id;
    const workspace = await prisma.account.findUnique({
        where: { id },
        include: {
            memberships: { include: { user: { select: { id: true, email: true, status: true } } } },
            brands: { select: { id: true, name: true, status: true, domain: true } },
            subscription: true,
            owner_settings: true,
        }
    });
    res.json({
        status: 'ok',
        mode: 'READ_ONLY_PREVIEW',
        workspace,
    });
});

router.post('/runs/:id/cancel', requireAdmin, async (req, res) => {
    const id = req.params.id;
    const run = await prisma.automationRun.update({
        where: { id },
        data: {
            status: 'ABORTED',
            abort_reason: 'Admin cancelled run',
            ended_at: new Date(),
            last_error: 'Cancelled from admin run center',
        }
    });
    await prisma.auditLog.create({
        data: {
            actor_id: req.admin!.id,
            actor_type: 'ADMIN',
            action: 'CANCEL_RUN',
            resource: 'AutomationRun',
            resource_id: id,
            workspace_id: null,
            meta: JSON.stringify({ brand_id: run.brand_id }),
            ip: req.ip || 'unknown',
        }
    });
    res.json({ status: 'ok', run });
});

router.post('/runs/:id/retry', requireAdmin, async (req, res) => {
    const id = req.params.id;
    const current = await prisma.automationRun.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ error: 'Run not found' });
    const retry = await prisma.automationRun.create({
        data: {
            brand_id: current.brand_id,
            install_id: current.install_id,
            platform: current.platform,
            discovery_mode: current.discovery_mode,
            discovery_intent: current.discovery_intent,
            status: 'PENDING',
            policy_id: current.policy_id,
            policy_snapshot: current.policy_snapshot,
            market_profile_snapshot: current.market_profile_snapshot,
            stats: {},
            attempt_count: (current.attempt_count || 0) + 1,
            last_error: null,
        }
    });
    await prisma.auditLog.create({
        data: {
            actor_id: req.admin!.id,
            actor_type: 'ADMIN',
            action: 'RETRY_RUN',
            resource: 'AutomationRun',
            resource_id: retry.id,
            workspace_id: null,
            meta: JSON.stringify({ source_run_id: id }),
            ip: req.ip || 'unknown',
        }
    });
    res.json({ status: 'ok', retry });
});

router.get('/runs/:id/logs', requireAdmin, async (req, res) => {
    const id = req.params.id;
    const run = await prisma.automationRun.findUnique({
        where: { id },
        include: {
            discovered_videos: {
                take: 20,
                orderBy: { discovered_at: 'desc' },
            }
        }
    });
    if (!run) return res.status(404).json({ error: 'Run not found' });
    const logLines = [
        `[Run] ${run.id}`,
        `[Status] ${run.status}`,
        `[Platform] ${run.platform}`,
        `[Started] ${run.started_at?.toISOString?.() || run.started_at}`,
        `[Ended] ${run.ended_at?.toISOString?.() || run.ended_at || 'in progress'}`,
        `[Error] ${run.last_error || run.abort_reason || 'none'}`,
        `[Stats] ${JSON.stringify(run.stats || {})}`,
        ...run.discovered_videos.slice(0, 10).map((video) => `[Discovery] ${video.decision} ${video.video_url} ${video.error_class || ''}`.trim()),
    ];
    res.json({ status: 'ok', logs: logLines, run });
});

router.get('/runs/:id/compare-previous', requireAdmin, async (req, res) => {
    const id = req.params.id;
    const run = await prisma.automationRun.findUnique({ where: { id } });
    if (!run) return res.status(404).json({ error: 'Run not found' });
    const previous = await prisma.automationRun.findFirst({
        where: {
            brand_id: run.brand_id,
            platform: run.platform,
            started_at: { lt: run.started_at },
        },
        orderBy: { started_at: 'desc' },
    });
    res.json({ status: 'ok', current: run, previous });
});

router.post('/platform-connections/:id/disable', requireAdmin, async (req, res) => {
    const id = req.params.id;
    const item = await prisma.brandPlatformConnection.update({
        where: { id },
        data: {
            status: 'DISCONNECTED',
            last_error: 'Disabled by admin',
            last_checked_at: new Date(),
        }
    });
    await prisma.auditLog.create({
        data: {
            actor_id: req.admin!.id,
            actor_type: 'ADMIN',
            action: 'DISABLE_INSTALL',
            resource: 'BrandPlatformConnection',
            resource_id: id,
            workspace_id: item.workspace_id,
            ip: req.ip || 'unknown',
        }
    });
    res.json({ status: 'ok', item });
});

router.post('/platform-connections/:id/revalidate', requireAdmin, async (req, res) => {
    const id = req.params.id;
    const current = await prisma.brandPlatformConnection.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ error: 'Connection not found' });
    const item = await prisma.brandPlatformConnection.update({
        where: { id },
        data: {
            last_checked_at: new Date(),
            last_verified_at: current.status === 'CONNECTED' ? new Date() : current.last_verified_at,
            verification_error: null,
        }
    });
    await prisma.auditLog.create({
        data: {
            actor_id: req.admin!.id,
            actor_type: 'ADMIN',
            action: 'REVALIDATE_INSTALL',
            resource: 'BrandPlatformConnection',
            resource_id: id,
            workspace_id: item.workspace_id,
            ip: req.ip || 'unknown',
        }
    });
    res.json({ status: 'ok', item });
});

router.post('/platform-connections/:id/mark-compromised', requireAdmin, async (req, res) => {
    const id = req.params.id;
    const item = await prisma.brandPlatformConnection.update({
        where: { id },
        data: {
            status: 'DISCONNECTED',
            verification_error: 'Marked compromised by admin',
            last_error: 'Session marked compromised',
            expires_at: new Date(),
        }
    });
    await prisma.auditLog.create({
        data: {
            actor_id: req.admin!.id,
            actor_type: 'ADMIN',
            action: 'MARK_INSTALL_COMPROMISED',
            resource: 'BrandPlatformConnection',
            resource_id: id,
            workspace_id: item.workspace_id,
            ip: req.ip || 'unknown',
        }
    });
    res.json({ status: 'ok', item });
});

router.post('/platform-connections/:id/rotate-install-secret', requireAdmin, async (req, res) => {
    const id = req.params.id;
    const connection = await prisma.brandPlatformConnection.findUnique({ where: { id } });
    if (!connection) return res.status(404).json({ error: 'Connection not found' });
    const installs = await prisma.installRegistry.findMany({
        where: { account_id: connection.workspace_id },
        select: { id: true, install_id: true }
    });
    const newSecret = randomBytes(24).toString('hex');
    const result = await prisma.installRegistry.updateMany({
        where: { account_id: connection.workspace_id },
        data: { install_secret: newSecret }
    });
    await prisma.auditLog.create({
        data: {
            actor_id: req.admin!.id,
            actor_type: 'ADMIN',
            action: 'ROTATE_INSTALL_SECRET',
            resource: 'InstallRegistry',
            resource_id: installs[0]?.id || connection.workspace_id,
            workspace_id: connection.workspace_id,
            meta: JSON.stringify({ updated: result.count }),
            ip: req.ip || 'unknown',
        }
    });
    res.json({ status: 'ok', updated: result.count, install_ids: installs.map((item) => item.install_id) });
});

router.post('/drafts/:id/approve', requireAdmin, async (req, res) => {
    const id = req.params.id;
    const draft = await prisma.outreachDraft.update({
        where: { id },
        data: {
            status: 'APPROVED',
            approved_at: new Date(),
            approved_by_user_id: req.admin!.id,
        }
    });
    await prisma.auditLog.create({
        data: {
            actor_id: req.admin!.id,
            actor_type: 'ADMIN',
            action: 'APPROVE_DRAFT',
            resource: 'OutreachDraft',
            resource_id: id,
            workspace_id: draft.account_id,
            ip: req.ip || 'unknown',
        }
    });
    res.json({ status: 'ok', draft });
});

router.post('/drafts/:id/reject', requireAdmin, async (req, res) => {
    const id = req.params.id;
    const draft = await prisma.outreachDraft.update({
        where: { id },
        data: {
            status: 'REJECTED',
            approved_at: null,
            approved_by_user_id: null,
        }
    });
    await prisma.auditLog.create({
        data: {
            actor_id: req.admin!.id,
            actor_type: 'ADMIN',
            action: 'REJECT_DRAFT',
            resource: 'OutreachDraft',
            resource_id: id,
            workspace_id: draft.account_id,
            ip: req.ip || 'unknown',
        }
    });
    res.json({ status: 'ok', draft });
});

router.post('/drafts/:id/request-revision', requireAdmin, async (req, res) => {
    const id = req.params.id;
    const draft = await prisma.outreachDraft.update({
        where: { id },
        data: {
            status: 'EDITED',
        }
    });
    await prisma.auditLog.create({
        data: {
            actor_id: req.admin!.id,
            actor_type: 'ADMIN',
            action: 'REQUEST_DRAFT_REVISION',
            resource: 'OutreachDraft',
            resource_id: id,
            workspace_id: draft.account_id,
            ip: req.ip || 'unknown',
        }
    });
    res.json({ status: 'ok', draft });
});

router.post('/leads/:id/relabel', requireAdmin, async (req, res) => {
    const id = req.params.id;
    const nextIntent = String(req.body?.intent || '').trim();
    const nextStage = String(req.body?.buyer_stage || '').trim();
    const nextAction = String(req.body?.recommended_action || '').trim();
    const current = await prisma.leadOpportunity.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ error: 'Lead not found' });
    const lead = await prisma.leadOpportunity.update({
        where: { id },
        data: {
            intent: nextIntent || current.intent,
            buyer_stage: (nextStage as any) || current.buyer_stage,
            recommended_action: (nextAction as any) || current.recommended_action,
        }
    });
    await prisma.auditLog.create({
        data: {
            actor_id: req.admin!.id,
            actor_type: 'ADMIN',
            action: 'RELABEL_LEAD',
            resource: 'LeadOpportunity',
            resource_id: id,
            workspace_id: lead.account_id,
            meta: JSON.stringify({ from: { intent: current.intent, buyer_stage: current.buyer_stage, recommended_action: current.recommended_action }, to: { intent: lead.intent, buyer_stage: lead.buyer_stage, recommended_action: lead.recommended_action } }),
            ip: req.ip || 'unknown',
        }
    });
    res.json({ status: 'ok', lead });
});

router.post('/policies/brands/:brandId/freeze', requireAdmin, async (req, res) => {
    const brandId = req.params.brandId;
    const result = await prisma.automationPolicy.updateMany({
        where: { brand_id: brandId, status: 'ACTIVE' as any },
        data: { status: 'PAUSED', enabled: false }
    });
    const brand = await prisma.brand.findUnique({ where: { id: brandId } });
    await prisma.auditLog.create({
        data: {
            actor_id: req.admin!.id,
            actor_type: 'ADMIN',
            action: 'FREEZE_AUTOMATION',
            resource: 'AutomationPolicy',
            resource_id: brandId,
            workspace_id: brand?.workspace_id,
            meta: JSON.stringify({ updated: result.count }),
            ip: req.ip || 'unknown',
        }
    });
    res.json({ status: 'ok', updated: result.count });
});

router.post('/policies/workspaces/:workspaceId/manual-review-only', requireAdmin, async (req, res) => {
    const workspaceId = req.params.workspaceId;
    const settings = await prisma.ownerSettings.upsert({
        where: { workspace_id: workspaceId },
        update: {
            reply_qualified_mode: 'MANUAL_REVIEW',
            reply_require_human_review_high_risk: true,
        },
        create: {
            workspace_id: workspaceId,
            reply_qualified_mode: 'MANUAL_REVIEW',
            reply_require_human_review_high_risk: true,
        }
    });
    await prisma.auditLog.create({
        data: {
            actor_id: req.admin!.id,
            actor_type: 'ADMIN',
            action: 'SET_MANUAL_REVIEW_ONLY',
            resource: 'OwnerSettings',
            resource_id: workspaceId,
            workspace_id: workspaceId,
            ip: req.ip || 'unknown',
        }
    });
    res.json({ status: 'ok', settings });
});

router.post('/billing/workspaces/:workspaceId/pause', requireAdmin, async (req, res) => {
    const workspaceId = req.params.workspaceId;
    const subscription = await prisma.workspaceSubscription.updateMany({
        where: { workspace_id: workspaceId },
        data: { status: 'PAUSED' }
    });
    await prisma.account.update({ where: { id: workspaceId }, data: { status: 'SUSPENDED' } });
    await prisma.auditLog.create({
        data: {
            actor_id: req.admin!.id,
            actor_type: 'ADMIN',
            action: 'PAUSE_BILLING',
            resource: 'WorkspaceSubscription',
            resource_id: workspaceId,
            workspace_id: workspaceId,
            ip: req.ip || 'unknown',
        }
    });
    res.json({ status: 'ok', updated: subscription.count });
});

router.post('/billing/workspaces/:workspaceId/enterprise-override', requireAdmin, async (req, res) => {
    const workspaceId = req.params.workspaceId;
    const subscription = await prisma.workspaceSubscription.upsert({
        where: { workspace_id: workspaceId },
        update: {
            plan_code: 'ENTERPRISE',
            display_name: 'Enterprise Override',
            metadata: { override: true },
        },
        create: {
            workspace_id: workspaceId,
            plan_code: 'ENTERPRISE',
            display_name: 'Enterprise Override',
            metadata: { override: true },
        }
    });
    await prisma.account.update({ where: { id: workspaceId }, data: { plan_id: 'ENTERPRISE', status: 'ACTIVE' } });
    await prisma.auditLog.create({
        data: {
            actor_id: req.admin!.id,
            actor_type: 'ADMIN',
            action: 'ENTERPRISE_OVERRIDE',
            resource: 'WorkspaceSubscription',
            resource_id: workspaceId,
            workspace_id: workspaceId,
            ip: req.ip || 'unknown',
        }
    });
    res.json({ status: 'ok', subscription });
});

router.get('/audit', requireAdmin, async (_req, res) => {
    const items = await prisma.auditLog.findMany({
        take: 100,
        orderBy: { created_at: 'desc' },
    });
    res.json({ items });
});

router.get('/system/health', requireAdmin, async (_req, res) => {
    const checks = await Promise.allSettled([
        fetch('http://localhost:3001/health').then(r => r.json()),
        fetch('http://ingestion-service:3005/health').then(r => r.json()).catch(() => ({ status: 'error' })),
        fetch('http://ai-core:8000/health').then(r => r.json()).catch(() => ({ status: 'error' })),
        fetch('http://video-detection-engine:8000/health').then(r => r.json()).catch(() => ({ status: 'error' })),
    ]);

    res.json({
        operator_api: checks[0].status === 'fulfilled' ? checks[0].value : { status: 'error' },
        ingestion_service: checks[1].status === 'fulfilled' ? checks[1].value : { status: 'error' },
        ai_core: checks[2].status === 'fulfilled' ? checks[2].value : { status: 'error' },
        automation_api: checks[3].status === 'fulfilled' ? checks[3].value : { status: 'error' },
    });
});

router.post('/workspaces/:id/suspend', requireAdmin, async (req, res) => {
    const id = req.params.id;
    const account = await prisma.account.update({
        where: { id },
        data: { status: 'SUSPENDED' }
    });
    await prisma.auditLog.create({
        data: {
            actor_id: req.admin!.id,
            actor_type: 'ADMIN',
            action: 'SUSPEND_WORKSPACE',
            resource: 'Account',
            resource_id: id,
            workspace_id: id,
            ip: req.ip || 'unknown',
        }
    });
    res.json({ status: 'ok', account });
});

router.post('/workspaces/:id/activate', requireAdmin, async (req, res) => {
    const id = req.params.id;
    const account = await prisma.account.update({
        where: { id },
        data: { status: 'ACTIVE' }
    });
    await prisma.auditLog.create({
        data: {
            actor_id: req.admin!.id,
            actor_type: 'ADMIN',
            action: 'ACTIVATE_WORKSPACE',
            resource: 'Account',
            resource_id: id,
            workspace_id: id,
            ip: req.ip || 'unknown',
        }
    });
    res.json({ status: 'ok', account });
});

router.post('/workspaces/:id/reset-automation-quota', requireAdmin, async (req, res) => {
    const id = req.params.id;
    const result = await prisma.workspaceUsageCounter.deleteMany({
        where: {
            workspace_id: id,
            metric_code: 'AUTOMATION_RUNS_CREATED',
            period_type: 'DAILY',
        }
    });
    await prisma.auditLog.create({
        data: {
            actor_id: req.admin!.id,
            actor_type: 'ADMIN',
            action: 'RESET_AUTOMATION_QUOTA',
            resource: 'WorkspaceUsageCounter',
            resource_id: id,
            workspace_id: id,
            meta: JSON.stringify({ deleted: result.count }),
            ip: req.ip || 'unknown',
        }
    });
    res.json({ status: 'ok', deleted: result.count });
});

export const adminRouter = router;
