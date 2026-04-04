
import { PrismaClient, BuyerStage, RecommendedAction } from '@syntrae/prisma-schema';
import { SubscriptionPolicyService, type WorkspacePlanSummary } from './billing/subscription_policy.service';

const prisma = new PrismaClient();

export interface DateRange {
    from: Date;
    to: Date;
}

export interface OverviewMetrics {
    total_leads: number;
    ready_leads: number;
    conversion_rate: number;
    priority_dm: number;
    avg_confidence: number;
}

export interface DashboardOverview {
    global: OverviewMetrics;
    brands: Record<string, OverviewMetrics>;
}

export interface BrandPerformance {
    id: string;
    name: string;
    metrics: OverviewMetrics;
    stages: Record<string, number>;
    intents: Array<{ intent: string; count: number }>;
}

export interface UsageMetrics {
    plan_id: string;
    plan_name: string;
    subscription_status: string;
    brands_used: number;
    brands_limit: number;
    team_members_used: number;
    team_members_limit: number;
    events_daily_used: number;
    events_daily_limit: number;
    events_monthly_used: number;
    events_monthly_limit: number;
    suggestions_daily_used: number;
    suggestions_daily_limit: number;
    automation_runs_daily_used: number;
    automation_runs_daily_limit: number;
    leads_exported_month: number;
    leads_export_limit: number;
    drafts_generated_month: number;
    leads_captured_month: number;
    features: WorkspacePlanSummary['features'];
    blocked: WorkspacePlanSummary['blocked'];
}

export class AnalyticsService {

    /**
     * Get high-level KPI overview for a workspace, including "All Brands" rollup and per-brand stats.
     */
    static async getOverviewStats(workspaceId: string, range: DateRange): Promise<DashboardOverview> {
        // 1. Fetch all leads in range for workspace
        const leads = await prisma.leadOpportunity.findMany({
            where: {
                account_id: workspaceId,
                created_at: {
                    gte: range.from,
                    lte: range.to,
                }
            },
            select: {
                id: true,
                brand_id: true,
                buyer_stage: true,
                recommended_action: true,
                confidence: true,
            }
        });

        // 2. Initial accumulators
        const global: OverviewMetrics = this.emptyMetrics();
        const brands: Record<string, OverviewMetrics> = {};

        // 3. Aggregate
        for (const lead of leads) {
            // Update Global
            this.updateMetrics(global, lead);

            // Update Brand
            if (!brands[lead.brand_id]) {
                brands[lead.brand_id] = this.emptyMetrics();
            }
            this.updateMetrics(brands[lead.brand_id], lead);
        }

        // 4. Finalize Averages/Rates
        this.finalizeMetrics(global);
        for (const bId in brands) {
            this.finalizeMetrics(brands[bId]);
        }

        return { global, brands };
    }

    /**
     * Get detailed performance stats for all brands in a workspace.
     */
    static async getBrandListStats(workspaceId: string, range: DateRange): Promise<BrandPerformance[]> {
        // Fetch brands to ensure we list even those with 0 leads
        const brands = await prisma.brand.findMany({
            where: { workspace_id: workspaceId },
            select: { id: true, name: true }
        });

        const leads = await prisma.leadOpportunity.findMany({
            where: {
                account_id: workspaceId,
                created_at: {
                    gte: range.from,
                    lte: range.to,
                }
            },
            select: {
                brand_id: true,
                buyer_stage: true,
                recommended_action: true,
                confidence: true,
                intent: true,
            }
        });

        // Map for quick lookup
        const performanceMap: Record<string, BrandPerformance> = {};

        // Initialize
        for (const b of brands) {
            performanceMap[b.id] = {
                id: b.id,
                name: b.name,
                metrics: this.emptyMetrics(),
                stages: {
                    [BuyerStage.AWARENESS]: 0,
                    [BuyerStage.EVALUATING]: 0,
                    [BuyerStage.READY]: 0,
                },
                intents: [] // We'll accumulate raw intents then group
            };
        }

        const intentCounts: Record<string, Record<string, number>> = {}; // brandId -> intent -> count

        for (const lead of leads) {
            const perf = performanceMap[lead.brand_id];
            if (!perf) continue; // Brand might have been deleted?

            this.updateMetrics(perf.metrics, lead);
            perf.stages[lead.buyer_stage] = (perf.stages[lead.buyer_stage] || 0) + 1;

            if (!intentCounts[lead.brand_id]) intentCounts[lead.brand_id] = {};
            intentCounts[lead.brand_id][lead.intent] = (intentCounts[lead.brand_id][lead.intent] || 0) + 1;
        }

        // Finalize
        return Object.values(performanceMap).map(perf => {
            this.finalizeMetrics(perf.metrics);

            // Process intents
            const counts = intentCounts[perf.id] || {};
            perf.intents = Object.entries(counts)
                .map(([intent, count]) => ({ intent, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 5); // Top 5

            return perf;
        });
    }

    /**
     * Get usage vs limits for billing.
     */
    static async getUsageStats(workspaceId: string): Promise<UsageMetrics> {
        const planSummary = await SubscriptionPolicyService.getWorkspacePlanSummary(workspaceId);

        // 2. Count monthly operational objects still not tracked in usage counters.
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const drafts = await prisma.outreachDraft.count({
            where: {
                account_id: workspaceId,
                created_at: { gte: startOfMonth }
            }
        });

        const leads = await prisma.leadOpportunity.count({
            where: {
                account_id: workspaceId,
                created_at: { gte: startOfMonth }
            }
        });

        return {
            plan_id: planSummary.plan_code,
            plan_name: planSummary.display_name,
            subscription_status: planSummary.subscription_status,
            brands_used: planSummary.usage.active_brands.used,
            brands_limit: planSummary.usage.active_brands.limit,
            team_members_used: planSummary.usage.team_members.used,
            team_members_limit: planSummary.usage.team_members.limit,
            events_daily_used: planSummary.usage.events_daily.used,
            events_daily_limit: planSummary.usage.events_daily.limit,
            events_monthly_used: planSummary.usage.events_monthly.used,
            events_monthly_limit: planSummary.usage.events_monthly.limit,
            suggestions_daily_used: planSummary.usage.suggestions_daily.used,
            suggestions_daily_limit: planSummary.usage.suggestions_daily.limit,
            automation_runs_daily_used: planSummary.usage.automation_runs_daily.used,
            automation_runs_daily_limit: planSummary.usage.automation_runs_daily.limit,
            leads_exported_month: planSummary.usage.lead_exports_monthly.used,
            leads_export_limit: planSummary.usage.lead_exports_monthly.limit,
            drafts_generated_month: drafts,
            leads_captured_month: leads,
            features: planSummary.features,
            blocked: planSummary.blocked,
        };
    }

    // --- Helpers ---

    private static emptyMetrics(): OverviewMetrics {
        return {
            total_leads: 0,
            ready_leads: 0,
            conversion_rate: 0,
            priority_dm: 0,
            avg_confidence: 0
        };
    }

    private static updateMetrics(m: OverviewMetrics, lead: { buyer_stage: string, recommended_action: string, confidence: number }) {
        m.total_leads++;
        m.avg_confidence += lead.confidence; // Sum for now

        if (lead.buyer_stage === BuyerStage.READY) {
            m.ready_leads++;
        }

        if (lead.recommended_action === RecommendedAction.PRIORITY_DM) {
            m.priority_dm++;
        }
    }

    private static finalizeMetrics(m: OverviewMetrics) {
        if (m.total_leads > 0) {
            m.conversion_rate = m.ready_leads / m.total_leads;
            m.avg_confidence = m.avg_confidence / m.total_leads;
        } else {
            m.conversion_rate = 0;
            m.avg_confidence = 0;
        }
    }
}
