import {
    BILLING_INTERVALS,
    buildFeatureFlags,
    canCreateAdditionalBrand,
    canCreateAutomationRun,
    canInviteTeamMember,
    canUsePlatform,
    evaluateUsage,
    getPlanDefinition,
    LIMIT_PERIODS,
    normalizePlanCode,
    PLAN_DEFINITIONS,
    PLAN_REASON_CODES,
    SUBSCRIPTION_STATUSES,
    USAGE_METRICS,
    type BillingInterval,
    type PlanCapabilities,
    type PlanCode,
    type PlanDefinition,
} from '@syntrae/commercial-plans';
import { prisma } from '../../db';
import { LeadQuotaService, type LeadQuotaSnapshot } from './lead_quota.service';
import { UsageAccountingService } from './usage_accounting.service';
import { StripeBillingService } from './stripe_billing.service';

export class SubscriptionPolicyError extends Error {
    code: string;
    details?: Record<string, unknown>;

    constructor(code: string, message: string, details?: Record<string, unknown>) {
        super(message);
        this.code = code;
        this.details = details;
    }
}

export interface WorkspacePlanSummary {
    workspace_id: string;
    plan_code: PlanCode;
    display_name: string;
    source: 'subscription' | 'account';
    subscription_status: string;
    billing_interval: BillingInterval;
    is_trial: boolean;
    trial_ends_at: string | null;
    current_period_start: string | null;
    current_period_end: string | null;
    scheduled_plan_code: PlanCode | null;
    billing: {
        provider: string;
        stripe_configured: boolean;
        customer_linked: boolean;
        subscription_linked: boolean;
        portal_available: boolean;
        manual_change_allowed: boolean;
    };
    lead_quota: LeadQuotaSnapshot;
    plan_options: Array<{
        plan_code: PlanCode;
        display_name: string;
        billing_intervals: BillingInterval[];
        checkout_enabled: boolean;
    }>;
    features: PlanCapabilities;
    limits: PlanDefinition['limits'];
    usage: {
        active_brands: { used: number; limit: number };
        team_members: { used: number; limit: number };
        events_daily: { used: number; limit: number };
        events_monthly: { used: number; limit: number };
        suggestions_daily: { used: number; limit: number };
        automation_runs_daily: { used: number; limit: number | null };
        leads_captured_monthly: { used: number; limit: number };
        lead_exports_monthly: { used: number; limit: number };
    };
    blocked: Array<{ code: string; message: string; current?: number; limit?: number | null }>;
}

export class SubscriptionPolicyService {
    static normalizePlanCode(planId?: string | null): PlanCode {
        return normalizePlanCode(planId);
    }

    static async ensureWorkspaceSubscription(workspaceId: string) {
        const account = await prisma.account.findUnique({
            where: { id: workspaceId },
            include: { subscription: true },
        });
        if (!account) throw new Error(`Workspace ${workspaceId} not found`);

        const normalizedPlan = normalizePlanCode(account.subscription?.plan_code || account.plan_id);
        const plan = getPlanDefinition(normalizedPlan);

        if (account.subscription) {
            if (account.subscription.plan_code !== plan.code || account.subscription.display_name !== plan.displayName) {
                await prisma.workspaceSubscription.update({
                    where: { workspace_id: workspaceId },
                    data: { plan_code: plan.code, display_name: plan.displayName },
                });
            }
            if (account.plan_id !== plan.code) {
                await prisma.account.update({
                    where: { id: workspaceId },
                    data: { plan_id: plan.code },
                });
            }

            return {
                accountPlanId: plan.code,
                source: 'subscription' as const,
                subscription: {
                    ...account.subscription,
                    plan_code: plan.code,
                    display_name: plan.displayName,
                },
                plan,
            };
        }

        const subscription = await prisma.workspaceSubscription.create({
            data: {
                workspace_id: workspaceId,
                plan_code: plan.code,
                display_name: plan.displayName,
                status: account.status === 'ACTIVE' ? SUBSCRIPTION_STATUSES.ACTIVE : SUBSCRIPTION_STATUSES.INACTIVE,
                billing_interval: BILLING_INTERVALS.MONTHLY,
            },
        });

        if (account.plan_id !== plan.code) {
            await prisma.account.update({
                where: { id: workspaceId },
                data: { plan_id: plan.code },
            });
        }

        return {
            accountPlanId: plan.code,
            source: 'account' as const,
            subscription,
            plan,
        };
    }

    static async getEffectivePlan(workspaceId: string) {
        return this.ensureWorkspaceSubscription(workspaceId);
    }

    static async changePlan(
        workspaceId: string,
        targetPlanCode: string,
        opts?: {
            billingInterval?: BillingInterval;
            status?: string;
            isTrial?: boolean;
            trialEndsAt?: Date | null;
            scheduledPlanCode?: string | null;
        }
    ) {
        const planCode = normalizePlanCode(targetPlanCode);
        const plan = getPlanDefinition(planCode);

        const subscription = await prisma.$transaction(async (tx) => {
            await tx.account.update({
                where: { id: workspaceId },
                data: { plan_id: plan.code, status: 'ACTIVE' },
            });

            return tx.workspaceSubscription.upsert({
                where: { workspace_id: workspaceId },
                update: {
                    plan_code: plan.code,
                    display_name: plan.displayName,
                    status: opts?.status || SUBSCRIPTION_STATUSES.ACTIVE,
                    billing_interval: opts?.billingInterval || BILLING_INTERVALS.MONTHLY,
                    is_trial: opts?.isTrial ?? false,
                    trial_ends_at: opts?.trialEndsAt ?? null,
                    scheduled_plan_code: opts?.scheduledPlanCode ? normalizePlanCode(opts.scheduledPlanCode) : null,
                },
                create: {
                    workspace_id: workspaceId,
                    plan_code: plan.code,
                    display_name: plan.displayName,
                    status: opts?.status || SUBSCRIPTION_STATUSES.ACTIVE,
                    billing_interval: opts?.billingInterval || BILLING_INTERVALS.MONTHLY,
                    is_trial: opts?.isTrial ?? false,
                    trial_ends_at: opts?.trialEndsAt ?? null,
                    scheduled_plan_code: opts?.scheduledPlanCode ? normalizePlanCode(opts.scheduledPlanCode) : null,
                },
            });
        });

        return { plan, subscription };
    }

    static async assertCanCreateAdditionalBrand(workspaceId: string) {
        const [{ plan }, currentBrands] = await Promise.all([
            this.getEffectivePlan(workspaceId),
            prisma.brand.count({ where: { workspace_id: workspaceId } }),
        ]);

        const decision = canCreateAdditionalBrand(plan.code, currentBrands);
        if (!decision.allowed) {
            throw new SubscriptionPolicyError(decision.reasonCode || PLAN_REASON_CODES.BRAND_LIMIT_REACHED, decision.message || 'Brand limit reached', {
                current: currentBrands,
                limit: plan.limits.maxBrands,
                plan_code: plan.code,
            });
        }

        return plan;
    }

    static async assertCanInviteTeamMember(workspaceId: string) {
        const [{ plan }, currentUsers] = await Promise.all([
            this.getEffectivePlan(workspaceId),
            prisma.workspaceMembership.count({ where: { workspace_id: workspaceId, status: 'ACTIVE' } }),
        ]);
        const decision = canInviteTeamMember(plan.code, currentUsers);
        if (!decision.allowed) {
            throw new SubscriptionPolicyError(decision.reasonCode || PLAN_REASON_CODES.TEAM_LIMIT_REACHED, decision.message || 'Team limit reached', {
                current: currentUsers,
                limit: plan.limits.maxUsers,
                plan_code: plan.code,
            });
        }

        return plan;
    }

    static async assertCanUsePlatform(workspaceId: string, platform: string) {
        const { plan } = await this.getEffectivePlan(workspaceId);
        const decision = canUsePlatform(plan.code, platform);
        if (!decision.allowed) {
            throw new SubscriptionPolicyError(decision.reasonCode || PLAN_REASON_CODES.PLATFORM_NOT_INCLUDED, decision.message || 'Platform not available', {
                plan_code: plan.code,
                platform,
            });
        }

        return plan;
    }

    static async assertCanCreateAutomationRun(workspaceId: string, platform: string, brandId?: string) {
        const { plan } = await this.getEffectivePlan(workspaceId);
        const platformDecision = canUsePlatform(plan.code, platform);
        if (!platformDecision.allowed) {
            throw new SubscriptionPolicyError(platformDecision.reasonCode || PLAN_REASON_CODES.PLATFORM_NOT_INCLUDED, platformDecision.message || 'Platform not available', {
                platform,
                plan_code: plan.code,
            });
        }

        const automationDecision = canCreateAutomationRun(plan.code);
        if (!automationDecision.allowed) {
            throw new SubscriptionPolicyError(automationDecision.reasonCode || PLAN_REASON_CODES.AUTOMATION_DISABLED, automationDecision.message || 'Automation disabled', {
                platform,
                plan_code: plan.code,
            });
        }

        const leadQuota = await LeadQuotaService.getQuotaSnapshot(workspaceId);
        if (leadQuota.remaining <= 0) {
            throw new SubscriptionPolicyError(
                'LEAD_QUOTA_REACHED',
                `Monthly lead quota reached (${leadQuota.used}/${leadQuota.limit}). Extend a 100-lead block or upgrade to a higher plan in Billing before starting another discovery run.`,
                {
                    plan_code: plan.code,
                    platform,
                    current: leadQuota.used,
                    limit: leadQuota.limit,
                    next_reset_at: leadQuota.next_reset_at,
                    overage_block_size: leadQuota.overage_block_size,
                    suggested_actions: ['extend_100_leads_block', 'upgrade_plan'],
                }
            );
        }

        const usageDecision = await UsageAccountingService.consume(prisma, {
            workspaceId,
            planCode: plan.code,
            metric: USAGE_METRICS.AUTOMATION_RUNS_CREATED,
            period: LIMIT_PERIODS.DAILY,
            increment: 1,
        });
        if (!usageDecision.allowed) {
            throw new SubscriptionPolicyError(usageDecision.reasonCode || PLAN_REASON_CODES.PLAN_LIMIT_REACHED, usageDecision.message || 'Automation quota exceeded', {
                current: usageDecision.currentValue,
                limit: usageDecision.limit,
                plan_code: plan.code,
            });
        }

        return plan;
    }

    static async getWorkspacePlanSummary(workspaceId: string): Promise<WorkspacePlanSummary> {
        const [{ plan, subscription, source }, activeBrands, teamMembers, leadQuota] = await Promise.all([
            this.getEffectivePlan(workspaceId),
            prisma.brand.count({ where: { workspace_id: workspaceId, status: 'ACTIVE' } }),
            prisma.workspaceMembership.count({ where: { workspace_id: workspaceId, status: 'ACTIVE' } }),
            LeadQuotaService.getQuotaSnapshot(workspaceId),
        ]);

        const [eventsDaily, eventsMonthly, suggestionsDaily, automationRunsDaily, leadExportsMonthly] = await Promise.all([
            UsageAccountingService.getCurrentValue(prisma, workspaceId, USAGE_METRICS.EVENTS_INGESTED, LIMIT_PERIODS.DAILY),
            UsageAccountingService.getCurrentValue(prisma, workspaceId, USAGE_METRICS.EVENTS_INGESTED, LIMIT_PERIODS.MONTHLY),
            UsageAccountingService.getCurrentValue(prisma, workspaceId, USAGE_METRICS.SUGGESTIONS_CREATED, LIMIT_PERIODS.DAILY),
            UsageAccountingService.getCurrentValue(prisma, workspaceId, USAGE_METRICS.AUTOMATION_RUNS_CREATED, LIMIT_PERIODS.DAILY),
            UsageAccountingService.getCurrentValue(prisma, workspaceId, USAGE_METRICS.LEADS_EXPORTED, LIMIT_PERIODS.MONTHLY),
        ]);

        const blocked = [
            evaluateUsage(plan.code, USAGE_METRICS.EVENTS_INGESTED, LIMIT_PERIODS.DAILY, eventsDaily, 1),
            evaluateUsage(plan.code, USAGE_METRICS.EVENTS_INGESTED, LIMIT_PERIODS.MONTHLY, eventsMonthly, 1),
            evaluateUsage(plan.code, USAGE_METRICS.SUGGESTIONS_CREATED, LIMIT_PERIODS.DAILY, suggestionsDaily, 1),
            evaluateUsage(plan.code, USAGE_METRICS.AUTOMATION_RUNS_CREATED, LIMIT_PERIODS.DAILY, automationRunsDaily, 1),
            leadQuota.used + 1 <= leadQuota.limit
                ? { allowed: true, reasonCode: null, message: null, current: leadQuota.used, limit: leadQuota.limit }
                : {
                    allowed: false,
                    reasonCode: PLAN_REASON_CODES.PLAN_LIMIT_REACHED,
                    message: `${plan.displayName} reached the monthly leads captured limit of ${leadQuota.limit}. Buy a 100-lead block or upgrade to continue.`,
                    current: leadQuota.used,
                    limit: leadQuota.limit,
                },
            canCreateAdditionalBrand(plan.code, activeBrands),
            canInviteTeamMember(plan.code, teamMembers),
        ]
            .filter((decision) => !decision.allowed)
            .map((decision) => ({
                code: decision.reasonCode || PLAN_REASON_CODES.UPGRADE_REQUIRED,
                message: decision.message || 'Upgrade required',
                current: decision.current,
                limit: decision.limit,
            }));

        return {
            workspace_id: workspaceId,
            plan_code: plan.code,
            display_name: plan.displayName,
            source,
            subscription_status: subscription.status,
            billing_interval: subscription.billing_interval as BillingInterval,
            is_trial: subscription.is_trial,
            trial_ends_at: subscription.trial_ends_at ? subscription.trial_ends_at.toISOString() : null,
            current_period_start: subscription.current_period_start ? subscription.current_period_start.toISOString() : null,
            current_period_end: subscription.current_period_end ? subscription.current_period_end.toISOString() : null,
            scheduled_plan_code: subscription.scheduled_plan_code ? normalizePlanCode(subscription.scheduled_plan_code) : null,
            billing: {
                provider: subscription.billing_provider || 'MANUAL',
                stripe_configured: StripeBillingService.isConfigured(),
                customer_linked: Boolean(subscription.stripe_customer_id),
                subscription_linked: Boolean(subscription.stripe_subscription_id),
                portal_available: StripeBillingService.isPortalAvailable(subscription),
                manual_change_allowed: StripeBillingService.manualPlanChangesAllowed(),
            },
            lead_quota: leadQuota,
            plan_options: Object.values(PLAN_DEFINITIONS)
                .sort((left, right) => left.rank - right.rank)
                .map((planDef) => ({
                    plan_code: planDef.code,
                    display_name: planDef.displayName,
                    billing_intervals: planDef.availableBillingIntervals,
                    checkout_enabled: StripeBillingService.getPlanCatalog().some((entry) => entry.plan_code === planDef.code && entry.checkout_enabled),
                })),
            features: buildFeatureFlags(plan.code),
            limits: plan.limits,
            usage: {
                active_brands: { used: activeBrands, limit: plan.limits.maxBrands },
                team_members: { used: teamMembers, limit: plan.limits.maxUsers },
                events_daily: { used: eventsDaily, limit: plan.limits.dailyProcessedEvents },
                events_monthly: { used: eventsMonthly, limit: plan.limits.monthlyProcessedEvents },
                suggestions_daily: { used: suggestionsDaily, limit: plan.limits.dailySuggestions },
                automation_runs_daily: { used: automationRunsDaily, limit: plan.limits.dailyAutomationRuns },
                leads_captured_monthly: { used: leadQuota.used, limit: leadQuota.limit },
                lead_exports_monthly: { used: leadExportsMonthly, limit: plan.limits.monthlyLeadExports },
            },
            blocked,
        };
    }
}
