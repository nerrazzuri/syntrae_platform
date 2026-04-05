
import { PrismaClient, BuyerStage, LeadStatus, RecommendedAction } from '@syntrae/prisma-schema';
import { SubscriptionPolicyService, type WorkspacePlanSummary } from './billing/subscription_policy.service';

const prisma = new PrismaClient();

export interface DateRange {
    from: Date;
    to: Date;
}

export interface OverviewMetrics {
    total_leads: number;
    ready_leads: number;
    high_intent_leads: number;
    contacted_leads: number;
    qualified_leads: number;
    converted_leads: number;
    lost_leads: number;
    conversion_rate: number;
    priority_dm: number;
    avg_confidence: number;
    estimated_revenue: number;
    avg_follow_up_hours: number | null;
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
    high_intent_leads_month: number;
    contacted_leads_month: number;
    qualified_leads_month: number;
    converted_leads_month: number;
    lost_leads_month: number;
    conversion_rate_month: number;
    estimated_revenue_month: number;
    avg_follow_up_hours_month: number | null;
    features: WorkspacePlanSummary['features'];
    blocked: WorkspacePlanSummary['blocked'];
}

interface LeadMetricRow {
    id: string;
    brand_id: string;
    buyer_stage: BuyerStage;
    recommended_action: RecommendedAction;
    lead_status: LeadStatus;
    confidence: number;
    created_at: Date;
    followed_up_at: Date | null;
    converted_at: Date | null;
    deal_value: number | null;
    intent?: string;
}

interface InternalMetrics {
    total_leads: number;
    ready_leads: number;
    high_intent_leads: number;
    worked_leads: number;
    contacted_leads: number;
    qualified_leads: number;
    converted_leads: number;
    lost_leads: number;
    conversion_rate: number;
    priority_dm: number;
    avg_confidence: number;
    estimated_revenue: number;
    avg_follow_up_hours: number | null;
    confidence_sum: number;
    follow_up_hours_sum: number;
    follow_up_count: number;
}

export class AnalyticsService {

    /**
     * Get high-level KPI overview for a workspace, including "All Brands" rollup and per-brand stats.
     */
    static async getOverviewStats(workspaceId: string, range: DateRange): Promise<DashboardOverview> {
        // Capture, follow-up, and conversion metrics use different business timestamps.
        const leads = await prisma.leadOpportunity.findMany({
            where: {
                account_id: workspaceId,
                OR: [
                    { created_at: { gte: range.from, lte: range.to } },
                    { followed_up_at: { gte: range.from, lte: range.to } },
                    { converted_at: { gte: range.from, lte: range.to } },
                ],
            },
            select: {
                id: true,
                brand_id: true,
                buyer_stage: true,
                recommended_action: true,
                confidence: true,
                lead_status: true,
                created_at: true,
                followed_up_at: true,
                converted_at: true,
                deal_value: true,
            }
        });

        // 2. Initial accumulators
        const global = this.emptyMetrics();
        const brands: Record<string, InternalMetrics> = {};

        // 3. Aggregate
        for (const lead of leads) {
            // Update Global
            this.updateMetrics(global, lead, range);

            // Update Brand
            if (!brands[lead.brand_id]) {
                brands[lead.brand_id] = this.emptyMetrics();
            }
            this.updateMetrics(brands[lead.brand_id], lead, range);
        }

        // 4. Finalize Averages/Rates
        const globalMetrics = this.finalizeMetrics(global);
        const brandMetrics: Record<string, OverviewMetrics> = {};
        for (const bId in brands) {
            brandMetrics[bId] = this.finalizeMetrics(brands[bId]);
        }

        return { global: globalMetrics, brands: brandMetrics };
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
                OR: [
                    { created_at: { gte: range.from, lte: range.to } },
                    { followed_up_at: { gte: range.from, lte: range.to } },
                    { converted_at: { gte: range.from, lte: range.to } },
                ],
            },
            select: {
                brand_id: true,
                buyer_stage: true,
                recommended_action: true,
                confidence: true,
                intent: true,
                lead_status: true,
                created_at: true,
                followed_up_at: true,
                converted_at: true,
                deal_value: true,
            }
        });

        // Map for quick lookup
        const performanceMap: Record<string, BrandPerformance> = {};
        const metricMap: Record<string, InternalMetrics> = {};

        // Initialize
        for (const b of brands) {
            performanceMap[b.id] = {
                id: b.id,
                name: b.name,
                metrics: this.finalizeMetrics(this.emptyMetrics()),
                stages: {
                    [BuyerStage.AWARENESS]: 0,
                    [BuyerStage.EVALUATING]: 0,
                    [BuyerStage.READY]: 0,
                },
                intents: [] // We'll accumulate raw intents then group
            };
            metricMap[b.id] = this.emptyMetrics();
        }

        const intentCounts: Record<string, Record<string, number>> = {}; // brandId -> intent -> count

        for (const lead of leads) {
            const perf = performanceMap[lead.brand_id];
            if (!perf) continue; // Brand might have been deleted?

            this.updateMetrics(metricMap[lead.brand_id], lead as LeadMetricRow, range);
            if (this.isWithin(lead.created_at, range)) {
                perf.stages[lead.buyer_stage] = (perf.stages[lead.buyer_stage] || 0) + 1;
            }

            if (!intentCounts[lead.brand_id]) intentCounts[lead.brand_id] = {};
            intentCounts[lead.brand_id][lead.intent] = (intentCounts[lead.brand_id][lead.intent] || 0) + 1;
        }

        // Finalize
        return Object.values(performanceMap).map(perf => {
            // Process intents
            const counts = intentCounts[perf.id] || {};
            perf.intents = Object.entries(counts)
                .map(([intent, count]) => ({ intent, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 5); // Top 5

            perf.metrics = this.finalizeMetrics(metricMap[perf.id]);

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

        const [drafts, leadRows] = await Promise.all([
            prisma.outreachDraft.count({
                where: {
                    account_id: workspaceId,
                    created_at: { gte: startOfMonth }
                }
            }),
            prisma.leadOpportunity.findMany({
                where: {
                    account_id: workspaceId,
                    OR: [
                        { created_at: { gte: startOfMonth } },
                        { followed_up_at: { gte: startOfMonth } },
                        { converted_at: { gte: startOfMonth } },
                    ],
                },
                select: {
                    id: true,
                    brand_id: true,
                    buyer_stage: true,
                    recommended_action: true,
                    lead_status: true,
                    confidence: true,
                    created_at: true,
                    followed_up_at: true,
                    converted_at: true,
                    deal_value: true,
                }
            })
        ]);

        const monthlyMetrics = this.finalizeMetrics(leadRows.reduce((acc, lead) => {
            this.updateMetrics(acc, lead as LeadMetricRow, { from: startOfMonth, to: now });
            return acc;
        }, this.emptyMetrics()));

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
            leads_captured_month: monthlyMetrics.total_leads,
            high_intent_leads_month: monthlyMetrics.high_intent_leads,
            contacted_leads_month: monthlyMetrics.contacted_leads,
            qualified_leads_month: monthlyMetrics.qualified_leads,
            converted_leads_month: monthlyMetrics.converted_leads,
            lost_leads_month: monthlyMetrics.lost_leads,
            conversion_rate_month: monthlyMetrics.conversion_rate,
            estimated_revenue_month: monthlyMetrics.estimated_revenue,
            avg_follow_up_hours_month: monthlyMetrics.avg_follow_up_hours,
            features: planSummary.features,
            blocked: planSummary.blocked,
        };
    }

    // --- Helpers ---

    private static emptyMetrics(): InternalMetrics {
        return {
            total_leads: 0,
            ready_leads: 0,
            high_intent_leads: 0,
            worked_leads: 0,
            contacted_leads: 0,
            qualified_leads: 0,
            converted_leads: 0,
            lost_leads: 0,
            conversion_rate: 0,
            priority_dm: 0,
            avg_confidence: 0,
            estimated_revenue: 0,
            avg_follow_up_hours: null,
            confidence_sum: 0,
            follow_up_hours_sum: 0,
            follow_up_count: 0,
        };
    }

    private static isWithin(value: Date | null | undefined, range: DateRange) {
        return Boolean(value && value >= range.from && value <= range.to);
    }

    private static updateMetrics(m: InternalMetrics, lead: LeadMetricRow, range: DateRange) {
        const capturedInWindow = this.isWithin(lead.created_at, range);
        const followedUpInWindow = this.isWithin(lead.followed_up_at, range);
        const convertedInWindow = this.isWithin(lead.converted_at, range);
        const workedInWindow = followedUpInWindow || convertedInWindow;

        if (capturedInWindow) {
            m.total_leads++;
            m.confidence_sum += lead.confidence;

            if (lead.buyer_stage === BuyerStage.READY) {
                m.ready_leads++;
            }

            if (lead.buyer_stage === BuyerStage.READY || lead.recommended_action === RecommendedAction.PRIORITY_DM) {
                m.high_intent_leads++;
            }

            if (lead.recommended_action === RecommendedAction.PRIORITY_DM) {
                m.priority_dm++;
            }
        }

        if (workedInWindow) {
            m.worked_leads++;
        }

        if (followedUpInWindow) {
            m.contacted_leads++;
            if (lead.lead_status === LeadStatus.QUALIFIED) {
                m.qualified_leads++;
            }
            const lagMs = lead.followed_up_at!.getTime() - lead.created_at.getTime();
            m.follow_up_hours_sum += Math.max(0, lagMs) / (1000 * 60 * 60);
            m.follow_up_count++;
        }

        if (convertedInWindow) {
            m.converted_leads++;
            m.estimated_revenue += Number(lead.deal_value || 0);
        }

        if (lead.lead_status === LeadStatus.LOST && followedUpInWindow) {
            m.lost_leads++;
        }
    }

    private static finalizeMetrics(m: InternalMetrics): OverviewMetrics {
        if (m.total_leads > 0) {
            m.avg_confidence = m.confidence_sum / m.total_leads;
        } else {
            m.avg_confidence = 0;
        }

        m.conversion_rate = m.worked_leads > 0 ? m.converted_leads / m.worked_leads : 0;

        m.avg_follow_up_hours = m.follow_up_count > 0 ? m.follow_up_hours_sum / m.follow_up_count : null;

        return {
            total_leads: m.total_leads,
            ready_leads: m.ready_leads,
            high_intent_leads: m.high_intent_leads,
            contacted_leads: m.contacted_leads,
            qualified_leads: m.qualified_leads,
            converted_leads: m.converted_leads,
            lost_leads: m.lost_leads,
            conversion_rate: m.conversion_rate,
            priority_dm: m.priority_dm,
            avg_confidence: m.avg_confidence,
            estimated_revenue: m.estimated_revenue,
            avg_follow_up_hours: m.avg_follow_up_hours,
        };
    }
}
