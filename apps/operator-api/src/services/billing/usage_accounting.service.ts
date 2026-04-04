import { Prisma, PrismaClient } from '@syntrae/prisma-schema';
import { randomUUID } from 'crypto';
import {
    evaluateUsage,
    LIMIT_PERIODS,
    PLAN_REASON_CODES,
    type LimitPeriod,
    type PlanCode,
    type UsageMetricCode,
} from '@syntrae/commercial-plans';

type DbClient = PrismaClient | Prisma.TransactionClient;

export interface UsageConsumeResult {
    allowed: boolean;
    currentValue: number;
    limit: number | null;
    reasonCode: string | null;
    message: string | null;
    period: LimitPeriod;
    metric: UsageMetricCode;
}

export class UsageAccountingService {
    static getPeriodStart(period: LimitPeriod, now = new Date()) {
        const start = new Date(now);
        if (period === LIMIT_PERIODS.DAILY) {
            start.setHours(0, 0, 0, 0);
            return start;
        }

        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        return start;
    }

    static async getCurrentValue(
        db: DbClient,
        workspaceId: string,
        metric: UsageMetricCode,
        period: LimitPeriod,
        brandId?: string | null
    ): Promise<number> {
        const scopeKey = brandId ? `brand:${brandId}` : 'workspace';
        const periodStart = this.getPeriodStart(period);

        const rows = await db.$queryRaw<{ current_value: number }[]>(Prisma.sql`
            SELECT "current_value"
            FROM "core"."WorkspaceUsageCounter"
            WHERE "workspace_id" = ${workspaceId}
              AND "scope_key" = ${scopeKey}
              AND "metric_code" = ${metric}
              AND "period_type" = ${period}
              AND "period_start" = ${periodStart}
            LIMIT 1
        `);

        return rows[0]?.current_value ?? 0;
    }

    static async consume(
        db: DbClient,
        params: {
            workspaceId: string;
            planCode: PlanCode;
            metric: UsageMetricCode;
            period: LimitPeriod;
            increment?: number;
            brandId?: string | null;
        }
    ): Promise<UsageConsumeResult> {
        const increment = params.increment ?? 1;
        const periodStart = this.getPeriodStart(params.period);
        const scopeKey = params.brandId ? `brand:${params.brandId}` : 'workspace';
        const limitDecision = evaluateUsage(params.planCode, params.metric, params.period, 0, increment);

        if (limitDecision.limit != null && increment > limitDecision.limit) {
            return {
                allowed: false,
                currentValue: 0,
                limit: limitDecision.limit,
                reasonCode: PLAN_REASON_CODES.PLAN_LIMIT_REACHED,
                message: limitDecision.message,
                period: params.period,
                metric: params.metric,
            };
        }

        const limit = limitDecision.limit ?? null;
        const rows = await db.$queryRaw<{ current_value: number }[]>(Prisma.sql`
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
            SELECT
                ${randomUUID()},
                ${params.workspaceId},
                ${params.brandId ?? null},
                ${scopeKey},
                ${params.metric},
                ${params.period},
                ${periodStart},
                ${increment},
                NOW(),
                NOW()
            WHERE ${limit == null ? Prisma.sql`TRUE` : Prisma.sql`${increment} <= ${limit}`}
            ON CONFLICT ("workspace_id", "scope_key", "metric_code", "period_type", "period_start")
            DO UPDATE SET
                "current_value" = "core"."WorkspaceUsageCounter"."current_value" + EXCLUDED."current_value",
                "blocked_at" = NULL,
                "block_reason_code" = NULL,
                "updated_at" = NOW()
            WHERE ${limit == null
                ? Prisma.sql`TRUE`
                : Prisma.sql`"core"."WorkspaceUsageCounter"."current_value" + EXCLUDED."current_value" <= ${limit}`}
            RETURNING "current_value"
        `);

        if (rows.length > 0) {
            return {
                allowed: true,
                currentValue: rows[0].current_value,
                limit,
                reasonCode: null,
                message: null,
                period: params.period,
                metric: params.metric,
            };
        }

        const currentValue = await this.getCurrentValue(db, params.workspaceId, params.metric, params.period, params.brandId);
        const blocked = evaluateUsage(params.planCode, params.metric, params.period, currentValue, increment);
        await db.$executeRaw(Prisma.sql`
            UPDATE "core"."WorkspaceUsageCounter"
            SET "blocked_at" = NOW(),
                "block_reason_code" = ${blocked.reasonCode ?? PLAN_REASON_CODES.PLAN_LIMIT_REACHED},
                "updated_at" = NOW()
            WHERE "workspace_id" = ${params.workspaceId}
              AND "scope_key" = ${scopeKey}
              AND "metric_code" = ${params.metric}
              AND "period_type" = ${params.period}
              AND "period_start" = ${periodStart}
        `);

        return {
            allowed: false,
            currentValue,
            limit,
            reasonCode: blocked.reasonCode,
            message: blocked.message,
            period: params.period,
            metric: params.metric,
        };
    }
}
