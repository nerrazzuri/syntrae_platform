import {
    BILLING_INTERVALS,
    buildFeatureFlags,
    canCreateAutomationRun,
    canUsePlatform,
    getPlanDefinition,
    normalizePlanCode,
    PLAN_REASON_CODES,
    SUBSCRIPTION_STATUSES,
    USAGE_METRICS,
    LIMIT_PERIODS,
    type PlanCode,
} from '@syntrae/commercial-plans';
import { prisma } from '../../db';
import { UsageAccountingService } from './usage_accounting_service';

export class SubscriptionPolicyError extends Error {
    code: string;
    details?: Record<string, unknown>;

    constructor(code: string, message: string, details?: Record<string, unknown>) {
        super(message);
        this.code = code;
        this.details = details;
    }
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

        if (!account.subscription) {
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
                await prisma.account.update({ where: { id: workspaceId }, data: { plan_id: plan.code } });
            }

            return { plan, subscription };
        }

        if (account.subscription.plan_code !== plan.code || account.subscription.display_name !== plan.displayName) {
            await prisma.workspaceSubscription.update({
                where: { workspace_id: workspaceId },
                data: { plan_code: plan.code, display_name: plan.displayName },
            });
        }
        if (account.plan_id !== plan.code) {
            await prisma.account.update({ where: { id: workspaceId }, data: { plan_id: plan.code } });
        }

        return {
            plan,
            subscription: {
                ...account.subscription,
                plan_code: plan.code,
                display_name: plan.displayName,
            },
        };
    }

    static async getEffectivePlan(workspaceId: string) {
        return this.ensureWorkspaceSubscription(workspaceId);
    }

    static async consumeUsage(params: {
        workspaceId: string;
        planCode: PlanCode;
        metric: keyof typeof USAGE_METRICS;
        period: keyof typeof LIMIT_PERIODS;
        increment?: number;
        brandId?: string | null;
    }) {
        return UsageAccountingService.consume(prisma, {
            workspaceId: params.workspaceId,
            planCode: params.planCode,
            metric: USAGE_METRICS[params.metric],
            period: LIMIT_PERIODS[params.period],
            increment: params.increment,
            brandId: params.brandId,
        });
    }

    static async assertCanProcessPlatform(workspaceId: string, platform: string) {
        const { plan } = await this.getEffectivePlan(workspaceId);
        const decision = canUsePlatform(plan.code, platform);
        if (!decision.allowed) {
            throw new SubscriptionPolicyError(decision.reasonCode || PLAN_REASON_CODES.PLATFORM_NOT_INCLUDED, decision.message || 'Platform not included', {
                plan_code: plan.code,
                platform,
            });
        }
        return plan;
    }

    static async assertCanAutomate(workspaceId: string, platform: string) {
        const { plan } = await this.getEffectivePlan(workspaceId);
        const platformDecision = canUsePlatform(plan.code, platform);
        if (!platformDecision.allowed) {
            throw new SubscriptionPolicyError(platformDecision.reasonCode || PLAN_REASON_CODES.PLATFORM_NOT_INCLUDED, platformDecision.message || 'Platform not included');
        }

        const automationDecision = canCreateAutomationRun(plan.code);
        if (!automationDecision.allowed) {
            throw new SubscriptionPolicyError(automationDecision.reasonCode || PLAN_REASON_CODES.AUTOMATION_DISABLED, automationDecision.message || 'Automation disabled');
        }

        return plan;
    }

    static async getPlanSnapshot(workspaceId: string) {
        const { plan, subscription } = await this.getEffectivePlan(workspaceId);
        return {
            plan_id: plan.code,
            name: plan.displayName,
            limits: plan.limits,
            features: buildFeatureFlags(plan.code),
            subscription_status: subscription.status,
            billing_interval: subscription.billing_interval,
        };
    }
}
