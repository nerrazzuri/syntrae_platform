import {
    buildFeatureFlags,
    canCreateAutomationRun,
    canUsePlatform,
    evaluateUsage,
    LIMIT_PERIODS,
    PLAN_REASON_CODES,
    USAGE_METRICS,
} from '@syntrae/commercial-plans';
import { prisma } from '../../db';
import { ProductDef } from './product_def';
import { SubscriptionPolicyError, SubscriptionPolicyService } from './subscription_policy_service';
import { UsageAccountingService } from './usage_accounting_service';

export type LimitMetric = 'events_per_day' | 'events_per_month' | 'suggestions_per_day' | 'team_members' | 'automation_runs_per_day';

export class ProductLimitError extends Error {
    code: string;
    details?: Record<string, unknown>;

    constructor(message: string, code = PLAN_REASON_CODES.PLAN_LIMIT_REACHED, details?: Record<string, unknown>) {
        super(message);
        this.name = 'ProductLimitError';
        this.code = code;
        this.details = details;
    }
}

export class PlanEnforcer {
    static async getPlanSnapshot(workspaceId: string) {
        const { plan } = await SubscriptionPolicyService.getEffectivePlan(workspaceId);
        return {
            id: plan.code,
            name: plan.displayName,
            limits: plan.limits,
            features: buildFeatureFlags(plan.code),
        };
    }

    static async checkLimit(workspaceId: string, metric: LimitMetric, currentAmount = 0): Promise<void> {
        const { plan } = await SubscriptionPolicyService.getEffectivePlan(workspaceId);
        const decision = resolveUsageDecision(plan.code, metric, currentAmount, 1);
        if (!decision.allowed) {
            throw new ProductLimitError(decision.message || 'Plan limit exceeded', decision.reasonCode || PLAN_REASON_CODES.PLAN_LIMIT_REACHED, {
                current: currentAmount,
                limit: decision.limit,
                metric,
                plan_code: plan.code,
            });
        }
    }

    static async consumeLimit(workspaceId: string, metric: Exclude<LimitMetric, 'team_members'>, increment = 1, brandId?: string | null) {
        const { plan } = await SubscriptionPolicyService.getEffectivePlan(workspaceId);
        const { usageMetric, period } = mapMetric(metric);
        const result = await UsageAccountingService.consume(prisma, {
            workspaceId,
            brandId,
            planCode: plan.code,
            metric: usageMetric,
            period,
            increment,
        });
        if (!result.allowed) {
            throw new ProductLimitError(result.message || 'Plan limit exceeded', result.reasonCode || PLAN_REASON_CODES.PLAN_LIMIT_REACHED, {
                current: result.currentValue,
                limit: result.limit,
                metric,
                plan_code: plan.code,
            });
        }
        return result;
    }

    static async isAutomationEligible(workspaceId: string, platform = 'tiktok'): Promise<boolean> {
        const { plan } = await SubscriptionPolicyService.getEffectivePlan(workspaceId);
        return canUsePlatform(plan.code, platform).allowed && canCreateAutomationRun(plan.code).allowed;
    }

    static async assertPlatformAccess(workspaceId: string, platform: string) {
        try {
            return await SubscriptionPolicyService.assertCanProcessPlatform(workspaceId, platform);
        } catch (error) {
            if (error instanceof SubscriptionPolicyError) {
                throw new ProductLimitError(error.message, error.code, error.details);
            }
            throw error;
        }
    }

    static async assertTeamCapacity(workspaceId: string) {
        const { plan } = await SubscriptionPolicyService.getEffectivePlan(workspaceId);
        const memberCount = await prisma.workspaceMembership.count({
            where: { workspace_id: workspaceId, status: 'ACTIVE' },
        });
        const decision = resolveUsageDecision(plan.code, 'team_members', memberCount, 1);
        if (!decision.allowed) {
            throw new ProductLimitError(decision.message || 'Plan limit exceeded', decision.reasonCode || PLAN_REASON_CODES.TEAM_LIMIT_REACHED, {
                current: memberCount,
                limit: decision.limit,
                metric: 'team_members',
                plan_code: plan.code,
            });
        }
    }
}

function mapMetric(metric: Exclude<LimitMetric, 'team_members'>) {
    switch (metric) {
        case 'events_per_day':
            return { usageMetric: USAGE_METRICS.EVENTS_INGESTED, period: LIMIT_PERIODS.DAILY } as const;
        case 'events_per_month':
            return { usageMetric: USAGE_METRICS.EVENTS_INGESTED, period: LIMIT_PERIODS.MONTHLY } as const;
        case 'suggestions_per_day':
            return { usageMetric: USAGE_METRICS.SUGGESTIONS_CREATED, period: LIMIT_PERIODS.DAILY } as const;
        case 'automation_runs_per_day':
            return { usageMetric: USAGE_METRICS.AUTOMATION_RUNS_CREATED, period: LIMIT_PERIODS.DAILY } as const;
    }
}

function resolveUsageDecision(planCode: string, metric: LimitMetric, current: number, increment: number) {
    switch (metric) {
        case 'events_per_day':
            return evaluateUsage(planCode, USAGE_METRICS.EVENTS_INGESTED, LIMIT_PERIODS.DAILY, current, increment);
        case 'events_per_month':
            return evaluateUsage(planCode, USAGE_METRICS.EVENTS_INGESTED, LIMIT_PERIODS.MONTHLY, current, increment);
        case 'suggestions_per_day':
            return evaluateUsage(planCode, USAGE_METRICS.SUGGESTIONS_CREATED, LIMIT_PERIODS.DAILY, current, increment);
        case 'automation_runs_per_day':
            return evaluateUsage(planCode, USAGE_METRICS.AUTOMATION_RUNS_CREATED, LIMIT_PERIODS.DAILY, current, increment);
        case 'team_members': {
            const plan = ProductDef.getPlan(planCode);
            if (current + increment <= plan.limits.max_team_members) {
                return { allowed: true, reasonCode: null, message: null, limit: plan.limits.max_team_members };
            }
            return {
                allowed: false,
                reasonCode: PLAN_REASON_CODES.TEAM_LIMIT_REACHED,
                message: `${plan.name} allows up to ${plan.limits.max_team_members} team members.`,
                limit: plan.limits.max_team_members,
            };
        }
    }
}
