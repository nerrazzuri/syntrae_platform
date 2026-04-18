import { SubscriptionPolicyService } from './subscription_policy.service';
import {
    LEAD_BLOCK_CURRENCY,
    LEAD_BLOCK_PRICE_MINOR,
    LEAD_BLOCK_SIZE,
    LeadCreditLedgerService,
} from './lead_credit_ledger.service';

const LEAD_WARNING_THRESHOLD = 0.8;
const LEAD_AUTO_EXTENSION_AVAILABLE = false;

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
        const { plan } = await SubscriptionPolicyService.getEffectivePlan(workspaceId);
        const breakdown = await LeadCreditLedgerService.getQuotaBreakdown(workspaceId, plan.code);
        return this.buildSnapshot(breakdown);
    }

    static async setAutoExtension(workspaceId: string, enabled: boolean) {
        if (enabled && !LEAD_AUTO_EXTENSION_AVAILABLE) {
            const error = new Error('Lead auto extension is not available. Buy a 100-lead block or upgrade before lead capture resumes after the monthly quota is reached.');
            (error as Error & { code?: string }).code = 'LEAD_AUTO_EXTENSION_UNAVAILABLE';
            throw error;
        }

        return this.getQuotaSnapshot(workspaceId);
    }

    static async reserveLeadCapacity(workspaceId: string): Promise<{
        allowed: boolean;
        quota: LeadQuotaSnapshot;
        auto_charged: boolean;
        charge?: null;
        reason_code?: string | null;
        message?: string | null;
    }> {
        const { plan } = await SubscriptionPolicyService.getEffectivePlan(workspaceId);
        const result = await LeadCreditLedgerService.reserveLeadCapture(workspaceId, plan.code);
        const quota = this.buildSnapshot(result.snapshot);

        if (result.consumed) {
            return {
                allowed: true,
                auto_charged: false,
                charge: null,
                quota,
            };
        }

        return {
            allowed: false,
            auto_charged: false,
            charge: null,
            reason_code: 'LEAD_QUOTA_REACHED',
            message: `Monthly lead quota reached (${quota.used}/${quota.limit}). Buy a 100-lead block or upgrade to continue capture.`,
            quota,
        };
    }

    private static buildSnapshot(breakdown: {
        used: number;
        included: number;
        rollover: number;
        extra: number;
        limit: number;
        remaining: number;
        nextResetAt: Date;
    }): LeadQuotaSnapshot {
        const limit = Math.max(breakdown.limit, 0);
        const used = Math.max(breakdown.used, 0);

        return {
            used,
            included: Math.max(breakdown.included, 0),
            rollover: Math.max(breakdown.rollover, 0),
            extra: Math.max(breakdown.extra, 0),
            limit,
            remaining: Math.max(breakdown.remaining, 0),
            auto_extension_enabled: false,
            warning_threshold: LEAD_WARNING_THRESHOLD,
            warning_reached: limit > 0 ? used / limit >= LEAD_WARNING_THRESHOLD : false,
            next_reset_at: breakdown.nextResetAt.toISOString(),
            overage_block_size: LEAD_BLOCK_SIZE,
            overage_block_price_minor: LEAD_BLOCK_PRICE_MINOR,
            overage_currency: LEAD_BLOCK_CURRENCY,
            overage_blocks_purchased: Math.floor(Math.max(breakdown.extra, 0) / LEAD_BLOCK_SIZE),
            last_auto_charge_at: null,
            last_invoice_id: null,
        };
    }
}
