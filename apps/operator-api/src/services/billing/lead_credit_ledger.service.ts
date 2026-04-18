import { randomUUID } from 'crypto';
import { Prisma, type PrismaClient } from '@syntrae/prisma-schema';
import { LIMIT_PERIODS, getPlanDefinition, type PlanCode } from '@syntrae/commercial-plans';
import { prisma } from '../../db';
import { UsageAccountingService } from './usage_accounting.service';

type DbClient = PrismaClient | Prisma.TransactionClient;

export const LEAD_CREDIT_TYPE = 'LEADS';
export const LEAD_BLOCK_SIZE = 100;
export const LEAD_BLOCK_PRICE_MINOR = 6900;
export const LEAD_BLOCK_CURRENCY = 'MYR';

const SOURCE_TYPES = {
    PLAN_ALLOCATION: 'PLAN_ALLOCATION',
    ROLLOVER: 'ROLLOVER',
    BLOCK_PURCHASE: 'BLOCK_PURCHASE',
    LEAD_CAPTURE: 'LEAD_CAPTURE',
} as const;
export const LEAD_CREDIT_SOURCE_TYPES = SOURCE_TYPES;

type LeadQuotaBreakdown = {
    used: number;
    included: number;
    rollover: number;
    extra: number;
    limit: number;
    remaining: number;
    periodStart: Date;
    nextResetAt: Date;
};

export class LeadCreditLedgerService {
    static async getQuotaBreakdown(workspaceId: string, planCode: PlanCode, db: DbClient = prisma): Promise<LeadQuotaBreakdown> {
        const periodStart = UsageAccountingService.getPeriodStart(LIMIT_PERIODS.MONTHLY);
        const nextResetAt = this.getNextResetAt(periodStart);

        await this.ensurePeriodCredits(db, workspaceId, planCode, periodStart, nextResetAt);
        return this.summarizePeriod(db, workspaceId, planCode, periodStart, nextResetAt);
    }

    static async reserveLeadCapture(workspaceId: string, planCode: PlanCode): Promise<{
        snapshot: LeadQuotaBreakdown;
        consumed: boolean;
    }> {
        return prisma.$transaction(async (tx) => {
            await this.lockWorkspaceSubscription(tx, workspaceId);
            const periodStart = UsageAccountingService.getPeriodStart(LIMIT_PERIODS.MONTHLY);
            const nextResetAt = this.getNextResetAt(periodStart);

            await this.ensurePeriodCredits(tx, workspaceId, planCode, periodStart, nextResetAt);
            const snapshot = await this.summarizePeriod(tx, workspaceId, planCode, periodStart, nextResetAt);

            if (snapshot.remaining <= 0) {
                return { snapshot, consumed: false };
            }

            await tx.workspaceCreditLedger.create({
                data: {
                    workspace_id: workspaceId,
                    credit_type: LEAD_CREDIT_TYPE,
                    delta: -1,
                    source_type: SOURCE_TYPES.LEAD_CAPTURE,
                    source_id: randomUUID(),
                    description: 'Lead captured from discovery pipeline',
                    period_start: periodStart,
                    expires_at: nextResetAt,
                },
            });

            return {
                consumed: true,
                snapshot: {
                    ...snapshot,
                    used: snapshot.used + 1,
                    remaining: snapshot.remaining - 1,
                },
            };
        });
    }

    static async creditPurchasedBlock(params: {
        workspaceId: string;
        sourceId: string;
        checkoutSessionId: string;
        quantity?: number;
    }, db: DbClient = prisma) {
        const quantity = Math.max(1, params.quantity || 1);
        const periodStart = UsageAccountingService.getPeriodStart(LIMIT_PERIODS.MONTHLY);
        const nextResetAt = this.getNextResetAt(periodStart);

        try {
            await db.workspaceCreditLedger.create({
                data: {
                    workspace_id: params.workspaceId,
                    credit_type: LEAD_CREDIT_TYPE,
                    delta: LEAD_BLOCK_SIZE * quantity,
                    source_type: SOURCE_TYPES.BLOCK_PURCHASE,
                    source_id: params.sourceId,
                    description: `Purchased ${LEAD_BLOCK_SIZE * quantity} additional leads`,
                    period_start: periodStart,
                    expires_at: nextResetAt,
                    metadata: {
                        checkout_session_id: params.checkoutSessionId,
                        block_size: LEAD_BLOCK_SIZE,
                        quantity,
                    } as Prisma.InputJsonValue,
                },
            });
        } catch (error: any) {
            if (error?.code === 'P2002') {
                return;
            }
            throw error;
        }
    }

    private static async ensurePeriodCredits(
        db: DbClient,
        workspaceId: string,
        planCode: PlanCode,
        periodStart: Date,
        nextResetAt: Date
    ) {
        const planSourceId = `plan:${periodStart.toISOString()}`;
        const existingPlanCredit = await db.workspaceCreditLedger.findFirst({
            where: {
                workspace_id: workspaceId,
                credit_type: LEAD_CREDIT_TYPE,
                source_type: SOURCE_TYPES.PLAN_ALLOCATION,
                source_id: planSourceId,
            },
            select: { id: true },
        });

        if (!existingPlanCredit) {
            await db.workspaceCreditLedger.create({
                data: {
                    workspace_id: workspaceId,
                    credit_type: LEAD_CREDIT_TYPE,
                    delta: getPlanDefinition(planCode).limits.monthlyCapturedLeads,
                    source_type: SOURCE_TYPES.PLAN_ALLOCATION,
                    source_id: planSourceId,
                    description: `${getPlanDefinition(planCode).displayName} monthly lead allocation`,
                    period_start: periodStart,
                    expires_at: nextResetAt,
                },
            });
        }

        const rolloverSourceId = `rollover:${periodStart.toISOString()}`;
        const existingRollover = await db.workspaceCreditLedger.findFirst({
            where: {
                workspace_id: workspaceId,
                credit_type: LEAD_CREDIT_TYPE,
                source_type: SOURCE_TYPES.ROLLOVER,
                source_id: rolloverSourceId,
            },
            select: { id: true },
        });

        if (!existingRollover) {
            const rollover = await this.computeRolloverLeadCredits(db, workspaceId, planCode, periodStart);
            if (rollover > 0) {
                await db.workspaceCreditLedger.create({
                    data: {
                        workspace_id: workspaceId,
                        credit_type: LEAD_CREDIT_TYPE,
                        delta: rollover,
                        source_type: SOURCE_TYPES.ROLLOVER,
                        source_id: rolloverSourceId,
                        description: 'Unused monthly leads rolled over',
                        period_start: periodStart,
                        expires_at: nextResetAt,
                        metadata: {
                            rollover_source_period: this.getPreviousPeriodStart(periodStart).toISOString(),
                        } as Prisma.InputJsonValue,
                    },
                });
            }
        }
    }

    private static async summarizePeriod(
        db: DbClient,
        workspaceId: string,
        planCode: PlanCode,
        periodStart: Date,
        nextResetAt: Date
    ): Promise<LeadQuotaBreakdown> {
        const rows = await db.$queryRaw<Array<{ source_type: string; total_delta: number }>>(Prisma.sql`
            SELECT "source_type", COALESCE(SUM("delta"), 0)::int AS "total_delta"
            FROM "core"."WorkspaceCreditLedger"
            WHERE "workspace_id" = ${workspaceId}
              AND "credit_type" = ${LEAD_CREDIT_TYPE}
              AND "period_start" = ${periodStart}
            GROUP BY "source_type"
        `);

        let included = 0;
        let rollover = 0;
        let extra = 0;
        let used = 0;

        for (const row of rows) {
            if (row.source_type === SOURCE_TYPES.PLAN_ALLOCATION) included += row.total_delta;
            if (row.source_type === SOURCE_TYPES.ROLLOVER) rollover += row.total_delta;
            if (row.source_type === SOURCE_TYPES.BLOCK_PURCHASE) extra += row.total_delta;
            if (row.source_type === SOURCE_TYPES.LEAD_CAPTURE) used += Math.abs(row.total_delta);
        }

        const fallbackIncluded = included || getPlanDefinition(planCode).limits.monthlyCapturedLeads;
        const limit = fallbackIncluded + rollover + extra;

        return {
            used,
            included: fallbackIncluded,
            rollover,
            extra,
            limit,
            remaining: Math.max(limit - used, 0),
            periodStart,
            nextResetAt,
        };
    }

    private static async computeRolloverLeadCredits(
        db: DbClient,
        workspaceId: string,
        planCode: PlanCode,
        periodStart: Date
    ) {
        const prevStart = this.getPreviousPeriodStart(periodStart);
        const prevSummary = await this.summarizePeriod(db, workspaceId, planCode, prevStart, periodStart);
        const rolloverUsed = Math.min(Math.max(prevSummary.rollover, 0), prevSummary.used);
        const includedUsed = Math.max(prevSummary.used - rolloverUsed, 0);
        const unusedIncluded = Math.max(prevSummary.included - includedUsed, 0);
        return Math.min(unusedIncluded, LEAD_BLOCK_SIZE);
    }

    private static getPreviousPeriodStart(periodStart: Date) {
        return new Date(periodStart.getFullYear(), periodStart.getMonth() - 1, 1);
    }

    private static getNextResetAt(periodStart: Date) {
        return new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 1);
    }

    private static async lockWorkspaceSubscription(db: DbClient, workspaceId: string) {
        await db.$queryRaw(Prisma.sql`
            SELECT "id"
            FROM "core"."WorkspaceSubscription"
            WHERE "workspace_id" = ${workspaceId}
            FOR UPDATE
        `);
    }
}
