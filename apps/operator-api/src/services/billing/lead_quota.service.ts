import { randomUUID } from 'crypto';
import { Prisma, type PrismaClient } from '@syntrae/prisma-schema';
import {
    LIMIT_PERIODS,
    USAGE_METRICS,
    getPlanDefinition,
    normalizePlanCode,
    type PlanCode,
} from '@syntrae/commercial-plans';
import { prisma } from '../../db';
import { StripeBillingError, StripeBillingService } from './stripe_billing.service';
import { SubscriptionPolicyService } from './subscription_policy.service';
import { UsageAccountingService } from './usage_accounting.service';

type DbClient = PrismaClient | Prisma.TransactionClient;

const LEAD_OVERAGE_BLOCK_SIZE = 100;
const LEAD_OVERAGE_BLOCK_PRICE_MINOR = 6900;
const LEAD_OVERAGE_CURRENCY = 'MYR';
const LEAD_WARNING_THRESHOLD = 0.8;

type LeadOverageConfig = {
    auto_extend_enabled: boolean;
    current_period_start: string;
    blocks_purchased: number;
    added_leads: number;
    rollover_leads: number;
    rollover_source_period: string | null;
    block_size: number;
    block_price_minor: number;
    currency: string;
    last_invoice_id: string | null;
    last_invoice_status: string | null;
    last_auto_charge_at: string | null;
};

type LeadOverageCharge = {
    block_number: number;
    block_size: number;
    amount_minor: number;
    currency: string;
    invoice_id: string;
    invoice_status: string;
    charged_at: string;
};

export interface LeadQuotaSnapshot {
    used: number;
    included: number;
    rollover: number;
    extra: number;
    limit: number;
    remaining: number;
    auto_extension_enabled: boolean;
    warning_threshold: number;
    warning_reached: boolean;
    next_reset_at: string;
    overage_block_size: number;
    overage_block_price_minor: number;
    overage_currency: string;
    overage_blocks_purchased: number;
    last_auto_charge_at: string | null;
    last_invoice_id: string | null;
}

export class LeadQuotaService {
    static async getQuotaSnapshot(workspaceId: string): Promise<LeadQuotaSnapshot> {
        const { plan, subscription } = await SubscriptionPolicyService.getEffectivePlan(workspaceId);
        const periodStart = UsageAccountingService.getPeriodStart(LIMIT_PERIODS.MONTHLY);
        const nextResetAt = this.getNextResetAt(periodStart);
        const config = await this.loadOverageConfig(workspaceId, plan.code, subscription.addon_config, periodStart);
        const used = await this.ensureLeadCounterInitialized(prisma, workspaceId, periodStart, nextResetAt);
        return this.buildSnapshot(plan.code, used, config, nextResetAt);
    }

    static async setAutoExtension(workspaceId: string, enabled: boolean) {
        const { plan, subscription } = await SubscriptionPolicyService.getEffectivePlan(workspaceId);
        const periodStart = UsageAccountingService.getPeriodStart(LIMIT_PERIODS.MONTHLY);
        const config = await this.loadOverageConfig(workspaceId, plan.code, subscription.addon_config, periodStart);
        config.auto_extend_enabled = enabled;

        await prisma.workspaceSubscription.update({
            where: { workspace_id: workspaceId },
            data: {
                addon_config: { lead_overage: config } as Prisma.InputJsonValue,
            },
        });

        const nextResetAt = this.getNextResetAt(periodStart);
        const used = await this.ensureLeadCounterInitialized(prisma, workspaceId, periodStart, nextResetAt);
        return this.buildSnapshot(plan.code as PlanCode, used, config, nextResetAt);
    }

    static async reserveLeadCapacity(workspaceId: string): Promise<{
        allowed: boolean;
        quota: LeadQuotaSnapshot;
        auto_charged: boolean;
        charge?: LeadOverageCharge | null;
        reason_code?: string | null;
        message?: string | null;
    }> {
        const { plan, subscription } = await SubscriptionPolicyService.getEffectivePlan(workspaceId);
        const periodStart = UsageAccountingService.getPeriodStart(LIMIT_PERIODS.MONTHLY);
        const nextResetAt = this.getNextResetAt(periodStart);

        const consumeExistingCapacity = async (extraLimit: number) => {
            return prisma.$transaction(async (tx) => {
                const used = await this.ensureLeadCounterInitialized(tx, workspaceId, periodStart, nextResetAt);
                const totalLimit = plan.limits.monthlyCapturedLeads + extraLimit;
                const result = await UsageAccountingService.consume(tx, {
                    workspaceId,
                    planCode: plan.code,
                    metric: USAGE_METRICS.LEADS_CAPTURED,
                    period: LIMIT_PERIODS.MONTHLY,
                    increment: 1,
                    limitOverride: totalLimit,
                });
                return { result, used_before: used };
            });
        };

        const initialConfig = await this.loadOverageConfig(workspaceId, plan.code, subscription.addon_config, periodStart);
        const initialAttempt = await consumeExistingCapacity(initialConfig.added_leads + initialConfig.rollover_leads);

        if (initialAttempt.result.allowed) {
            return {
                allowed: true,
                auto_charged: false,
                charge: null,
                quota: this.buildSnapshot(plan.code, initialAttempt.result.currentValue, initialConfig, nextResetAt),
            };
        }

        if (!initialConfig.auto_extend_enabled) {
            return {
                allowed: false,
                auto_charged: false,
                charge: null,
                reason_code: initialAttempt.result.reasonCode,
                message: initialAttempt.result.message,
                quota: this.buildSnapshot(plan.code, initialAttempt.result.currentValue, initialConfig, nextResetAt),
            };
        }

        if (subscription.billing_provider !== 'STRIPE' || !subscription.stripe_customer_id || !subscription.stripe_subscription_id) {
            return {
                allowed: false,
                auto_charged: false,
                charge: null,
                reason_code: 'LEAD_OVERAGE_STRIPE_REQUIRED',
                message: 'Automatic lead extension requires an active Stripe subscription with a saved payment method.',
                quota: this.buildSnapshot(plan.code, initialAttempt.result.currentValue, initialConfig, nextResetAt),
            };
        }

        const workspace = await prisma.account.findUnique({
            where: { id: workspaceId },
            select: { name: true },
        });
        if (!workspace) {
            return {
                allowed: false,
                auto_charged: false,
                charge: null,
                reason_code: 'WORKSPACE_NOT_FOUND',
                message: 'Workspace not found.',
                quota: this.buildSnapshot(plan.code, initialAttempt.result.currentValue, initialConfig, nextResetAt),
            };
        }

        let charge: LeadOverageCharge;
        try {
            charge = await StripeBillingService.chargeLeadOverageBlock({
                workspaceId,
                workspaceName: workspace.name,
                stripeCustomerId: subscription.stripe_customer_id,
                stripeSubscriptionId: subscription.stripe_subscription_id,
                blockNumber: initialConfig.blocks_purchased + 1,
                periodStart: periodStart.toISOString(),
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Automatic lead extension charge failed.';
            return {
                allowed: false,
                auto_charged: false,
                charge: null,
                reason_code: error instanceof StripeBillingError ? error.code : 'LEAD_OVERAGE_CHARGE_FAILED',
                message,
                quota: this.buildSnapshot(plan.code, initialAttempt.result.currentValue, initialConfig, nextResetAt),
            };
        }

        const updatedConfig = await prisma.$transaction(async (tx) => {
            const latestSubscription = await tx.workspaceSubscription.findUnique({
                where: { workspace_id: workspaceId },
                select: { addon_config: true },
            });
            const latestConfig = await this.loadOverageConfig(workspaceId, plan.code, latestSubscription?.addon_config, periodStart, tx);
            const appliedBlocks = Math.max(latestConfig.blocks_purchased, charge.block_number);
            latestConfig.blocks_purchased = appliedBlocks;
            latestConfig.added_leads = appliedBlocks * latestConfig.block_size;
            latestConfig.last_invoice_id = charge.invoice_id;
            latestConfig.last_invoice_status = charge.invoice_status;
            latestConfig.last_auto_charge_at = charge.charged_at;

            const existingSubscription = await tx.workspaceSubscription.findUnique({
                where: { workspace_id: workspaceId },
                select: { metadata: true },
            });
            const metadata = this.jsonObject(existingSubscription?.metadata);
            const history = Array.isArray(metadata.lead_overage_history)
                ? metadata.lead_overage_history as Array<Record<string, unknown>>
                : [];
            history.unshift({
                invoice_id: charge.invoice_id,
                invoice_status: charge.invoice_status,
                amount_minor: charge.amount_minor,
                currency: charge.currency,
                block_size: charge.block_size,
                block_number: charge.block_number,
                charged_at: charge.charged_at,
            });

            await tx.workspaceSubscription.update({
                where: { workspace_id: workspaceId },
                data: {
                    addon_config: { lead_overage: latestConfig } as Prisma.InputJsonValue,
                    metadata: {
                        ...metadata,
                        lead_overage_history: history.slice(0, 25),
                    } as Prisma.InputJsonValue,
                },
            });

            return latestConfig;
        });

        const secondAttempt = await consumeExistingCapacity(updatedConfig.added_leads + updatedConfig.rollover_leads);
        return {
            allowed: secondAttempt.result.allowed,
            auto_charged: true,
            charge,
            reason_code: secondAttempt.result.reasonCode,
            message: secondAttempt.result.message,
            quota: this.buildSnapshot(plan.code, secondAttempt.result.currentValue, updatedConfig, nextResetAt),
        };
    }

    private static buildSnapshot(planCode: PlanCode, used: number, config: LeadOverageConfig, nextResetAt: Date): LeadQuotaSnapshot {
        const included = getPlanDefinition(planCode).limits.monthlyCapturedLeads;
        const limit = included + config.rollover_leads + config.added_leads;
        return {
            used,
            included,
            rollover: config.rollover_leads,
            extra: config.added_leads,
            limit,
            remaining: Math.max(limit - used, 0),
            auto_extension_enabled: config.auto_extend_enabled,
            warning_threshold: LEAD_WARNING_THRESHOLD,
            warning_reached: limit > 0 ? used / limit >= LEAD_WARNING_THRESHOLD : false,
            next_reset_at: nextResetAt.toISOString(),
            overage_block_size: config.block_size,
            overage_block_price_minor: config.block_price_minor,
            overage_currency: config.currency,
            overage_blocks_purchased: config.blocks_purchased,
            last_auto_charge_at: config.last_auto_charge_at,
            last_invoice_id: config.last_invoice_id,
        };
    }

    private static async loadOverageConfig(
        workspaceId: string,
        planCode: PlanCode,
        rawValue: unknown,
        periodStart: Date,
        db: DbClient = prisma
    ): Promise<LeadOverageConfig> {
        const raw = this.jsonObject(rawValue).lead_overage;
        const config = this.jsonObject(raw);
        const currentPeriodStart = periodStart.toISOString();
        const samePeriod = String(config.current_period_start || '') === currentPeriodStart;
        const expectedPrevStart = this.getPreviousPeriodStart(periodStart).toISOString();
        const previousRollover = samePeriod
            ? this.toInt(config.rollover_leads)
            : (String(config.current_period_start || '') === expectedPrevStart ? this.toInt(config.rollover_leads) : 0);
        const rollover = samePeriod
            ? previousRollover
            : await this.computeRolloverLeads(db, workspaceId, planCode, periodStart, previousRollover);
        const rolloverSource = samePeriod ? this.toNullableString(config.rollover_source_period) : this.getPreviousPeriodStart(periodStart).toISOString();

        const normalized: LeadOverageConfig = {
            auto_extend_enabled: typeof config.auto_extend_enabled === 'boolean' ? config.auto_extend_enabled : true,
            current_period_start: currentPeriodStart,
            blocks_purchased: samePeriod ? this.toInt(config.blocks_purchased) : 0,
            added_leads: samePeriod ? this.toInt(config.added_leads) : 0,
            rollover_leads: rollover,
            rollover_source_period: rolloverSource,
            block_size: this.toInt(config.block_size) || LEAD_OVERAGE_BLOCK_SIZE,
            block_price_minor: this.toInt(config.block_price_minor) || LEAD_OVERAGE_BLOCK_PRICE_MINOR,
            currency: String(config.currency || LEAD_OVERAGE_CURRENCY),
            last_invoice_id: samePeriod ? this.toNullableString(config.last_invoice_id) : null,
            last_invoice_status: samePeriod ? this.toNullableString(config.last_invoice_status) : null,
            last_auto_charge_at: samePeriod ? this.toNullableString(config.last_auto_charge_at) : null,
        };

        if (!samePeriod) {
            await db.workspaceSubscription.update({
                where: { workspace_id: workspaceId },
                data: { addon_config: { lead_overage: normalized } as Prisma.InputJsonValue },
            });
        }

        return normalized;
    }

    private static getPreviousPeriodStart(periodStart: Date) {
        return new Date(periodStart.getFullYear(), periodStart.getMonth() - 1, 1);
    }

    private static async computeRolloverLeads(
        db: DbClient,
        workspaceId: string,
        planCode: PlanCode,
        periodStart: Date,
        previousRollover: number,
    ) {
        const prevStart = this.getPreviousPeriodStart(periodStart);
        const prevEnd = periodStart;
        const included = getPlanDefinition(planCode).limits.monthlyCapturedLeads;
        const rows = await db.$queryRaw<Array<{ current_value: number }>>(Prisma.sql`
            SELECT "current_value"
            FROM "core"."WorkspaceUsageCounter"
            WHERE "workspace_id" = ${workspaceId}
              AND "scope_key" = 'workspace'
              AND "metric_code" = ${USAGE_METRICS.LEADS_CAPTURED}
              AND "period_type" = ${LIMIT_PERIODS.MONTHLY}
              AND "period_start" = ${prevStart}
            LIMIT 1
        `);
        const usedPrev = rows[0]?.current_value ?? await db.leadOpportunity.count({
            where: {
                account_id: workspaceId,
                created_at: { gte: prevStart, lt: prevEnd },
            },
        });
        const rolloverUsed = Math.min(Math.max(previousRollover, 0), usedPrev);
        const includedUsed = Math.max(usedPrev - rolloverUsed, 0);
        const unusedIncluded = Math.max(included - includedUsed, 0);
        return Math.min(unusedIncluded, LEAD_OVERAGE_BLOCK_SIZE);
    }

    private static getNextResetAt(periodStart: Date) {
        return new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 1);
    }

    private static async ensureLeadCounterInitialized(
        db: DbClient,
        workspaceId: string,
        periodStart: Date,
        nextResetAt: Date,
    ) {
        const rows = await db.$queryRaw<Array<{ current_value: number }>>(Prisma.sql`
            SELECT "current_value"
            FROM "core"."WorkspaceUsageCounter"
            WHERE "workspace_id" = ${workspaceId}
              AND "scope_key" = 'workspace'
              AND "metric_code" = ${USAGE_METRICS.LEADS_CAPTURED}
              AND "period_type" = ${LIMIT_PERIODS.MONTHLY}
              AND "period_start" = ${periodStart}
            LIMIT 1
        `);

        if (rows[0]) {
            return rows[0].current_value;
        }

        const currentLeadCount = await db.leadOpportunity.count({
            where: {
                account_id: workspaceId,
                created_at: {
                    gte: periodStart,
                    lt: nextResetAt,
                },
            },
        });

        await db.$executeRaw(Prisma.sql`
            INSERT INTO "core"."WorkspaceUsageCounter" (
                "id",
                "workspace_id",
                "brand_id",
                "scope_key",
                "metric_code",
                "period_type",
                "period_start",
                "current_value",
                "created_at",
                "updated_at"
            )
            VALUES (
                ${randomUUID()},
                ${workspaceId},
                NULL,
                'workspace',
                ${USAGE_METRICS.LEADS_CAPTURED},
                ${LIMIT_PERIODS.MONTHLY},
                ${periodStart},
                ${currentLeadCount},
                NOW(),
                NOW()
            )
            ON CONFLICT ("workspace_id", "scope_key", "metric_code", "period_type", "period_start") DO NOTHING
        `);

        return currentLeadCount;
    }

    private static jsonObject(value: unknown): Record<string, unknown> {
        return value && typeof value === 'object' && !Array.isArray(value)
            ? { ...(value as Record<string, unknown>) }
            : {};
    }

    private static toInt(value: unknown) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
    }

    private static toNullableString(value: unknown) {
        const text = String(value || '').trim();
        return text ? text : null;
    }
}
