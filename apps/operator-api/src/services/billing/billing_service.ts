import { getPlanDefinition, PLAN_CODES, type PlanCode } from '@syntrae/commercial-plans';
import { prisma } from '../../db';
import { SubscriptionPolicyService } from './subscription_policy.service';

export class BillingService {
    static async changePlan(accountId: string, targetPlanCode: string) {
        const normalized = SubscriptionPolicyService.normalizePlanCode(targetPlanCode);
        const result = await SubscriptionPolicyService.changePlan(accountId, normalized);

        if (normalized !== PLAN_CODES.STARTER) {
            await prisma.brand.updateMany({
                where: { workspace_id: accountId },
                data: { status: 'ACTIVE' },
            });
        }

        return result;
    }

    static async upgradeToPro(accountId: string) {
        const { subscription } = await this.changePlan(accountId, PLAN_CODES.PRO);
        return { plan_id: subscription.plan_code, status: 'ACTIVE' };
    }

    static async downgradeToFree(accountId: string) {
        return this.downgradeToPlan(accountId, PLAN_CODES.STARTER);
    }

    static async downgradeToPlan(accountId: string, targetPlanCode: PlanCode) {
        const summary = await SubscriptionPolicyService.getWorkspacePlanSummary(accountId);
        if (summary.usage.active_brands.used <= getStarterBrandLimit()) {
            const { subscription } = await this.changePlan(accountId, targetPlanCode);
            return { plan_id: subscription.plan_code, status: 'ACTIVE' };
        }

        await prisma.account.update({
            where: { id: accountId },
            data: { status: 'PENDING_DOWNGRADE' },
        });

        await prisma.workspaceSubscription.upsert({
            where: { workspace_id: accountId },
            update: {
                scheduled_plan_code: targetPlanCode,
                status: 'ACTIVE',
            },
            create: {
                workspace_id: accountId,
                plan_code: summary.plan_code,
                display_name: summary.display_name,
                status: 'ACTIVE',
                billing_interval: summary.billing_interval,
                scheduled_plan_code: targetPlanCode,
            },
        });

        return { plan_id: summary.plan_code, status: 'PENDING_DOWNGRADE' };
    }

    static async resolveDowngrade(accountId: string, keepBrandId: string) {
        return prisma.$transaction(async (tx) => {
            const brand = await tx.brand.findFirst({
                where: { id: keepBrandId, workspace_id: accountId },
            });
            if (!brand) throw new Error('Brand not found');

            await tx.brand.updateMany({
                where: {
                    workspace_id: accountId,
                    id: { not: keepBrandId },
                },
                data: { status: 'PAUSED' },
            });

            await tx.brand.update({
                where: { id: keepBrandId },
                data: { status: 'ACTIVE' },
            });

            await tx.account.update({
                where: { id: accountId },
                data: { status: 'ACTIVE', plan_id: PLAN_CODES.STARTER },
            });

            const subscription = await tx.workspaceSubscription.upsert({
                where: { workspace_id: accountId },
                update: {
                    plan_code: PLAN_CODES.STARTER,
                    display_name: 'Starter',
                    scheduled_plan_code: null,
                    status: 'ACTIVE',
                },
                create: {
                    workspace_id: accountId,
                    plan_code: PLAN_CODES.STARTER,
                    display_name: 'Starter',
                    status: 'ACTIVE',
                    billing_interval: 'MONTHLY',
                },
            });

            return {
                plan_id: subscription.plan_code,
                status: 'ACTIVE',
            };
        });
    }
}

function getStarterBrandLimit() {
    return getPlanDefinition(PLAN_CODES.STARTER).limits.maxBrands;
}
