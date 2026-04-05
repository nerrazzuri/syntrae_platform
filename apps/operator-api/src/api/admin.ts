import { Router } from 'express';
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
    const [
        workspace_count,
        user_count,
        active_brand_count,
        active_connection_count,
        pending_run_count,
        running_run_count,
        lead_count,
        draft_count,
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
    res.json({ items });
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
