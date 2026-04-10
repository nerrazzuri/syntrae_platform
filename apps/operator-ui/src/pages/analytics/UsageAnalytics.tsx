import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { Activity, Zap, ArrowUpRight } from 'lucide-react';

interface UsageData {
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
    automation_runs_daily_limit: number | null;
    leads_rollover_month: number;
    leads_captured_limit: number;
    leads_captured_remaining: number;
    lead_auto_extension_enabled: boolean;
    lead_warning_threshold: number;
    lead_warning_reached: boolean;
    lead_overage_block_size: number;
    lead_overage_block_price_minor: number;
    lead_overage_currency: string;
    lead_next_reset_at: string;
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
    features: Record<string, boolean>;
    blocked: Array<{ code: string; message: string }>;
}

function currency(value: number) {
    return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR', maximumFractionDigits: 0 }).format(value || 0);
}

function buildUsagePrompts(data: UsageData) {
    const prompts: Array<{ title: string; message: string }> = [];

    if (!data.features.exportEnabled && data.high_intent_leads_month >= 5) {
        prompts.push({
            title: 'Export qualified leads',
            message: `You captured ${data.high_intent_leads_month} high-intent leads this month. Upgrade to Growth to export them into your CRM or follow-up workflow.`,
        });
    }

    if (!data.features.assistedReplyDrafts && data.high_intent_leads_month >= 5) {
        prompts.push({
            title: 'Speed up follow-up',
            message: `Upgrade to Growth to turn qualified leads into operator-reviewed reply drafts faster.`,
        });
    }

    if (data.automation_runs_daily_limit != null && data.automation_runs_daily_used >= data.automation_runs_daily_limit && data.plan_id !== 'PRO' && data.plan_id !== 'AGENCY') {
        prompts.push({
            title: 'Scale automation',
            message: `Your workspace is hitting daily automation limits. Upgrade to Pro to scale multi-brand workflows and higher automation throughput.`,
        });
    }

    if (data.leads_captured_limit > 0 && data.leads_captured_month >= Math.max(1, Math.floor(data.leads_captured_limit * data.lead_warning_threshold))) {
        const blockPrice = new Intl.NumberFormat('en-MY', {
            style: 'currency',
            currency: data.lead_overage_currency || 'MYR',
            maximumFractionDigits: 0,
        }).format((data.lead_overage_block_price_minor || 0) / 100);
        prompts.push({
            title: 'Lead quota almost full',
            message: data.lead_auto_extension_enabled
                ? `You are at ${data.leads_captured_month}/${data.leads_captured_limit} monthly leads. Syntrae will auto-charge ${blockPrice} for each extra ${data.lead_overage_block_size} leads unless you turn automatic extension off.`
                : `You are at ${data.leads_captured_month}/${data.leads_captured_limit} monthly leads. Turn automatic extension back on or upgrade before new lead capture stops.`,
        });
    }

    return prompts;
}

export const UsageAnalytics = () => {
    const [data, setData] = useState<UsageData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            const res = await api.analytics.getUsage();
            setData(res);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    if (loading) return <div className="p-8">Loading usage...</div>;
    if (!data) return <div className="p-8">No usage data.</div>;

    const rows = [
        { label: 'Leads Captured This Month', used: data.leads_captured_month, limit: data.leads_captured_limit },
        { label: 'Rollover Leads (max 100)', used: data.leads_rollover_month, limit: 100 },
        { label: 'Active Brands', used: data.brands_used, limit: data.brands_limit },
        { label: 'Team Members', used: data.team_members_used, limit: data.team_members_limit },
        { label: 'Processed Events Today', used: data.events_daily_used, limit: data.events_daily_limit },
        { label: 'Processed Events This Month', used: data.events_monthly_used, limit: data.events_monthly_limit },
        { label: 'Drafts Created Today', used: data.suggestions_daily_used, limit: data.suggestions_daily_limit },
        { label: 'Automation Runs Today', used: data.automation_runs_daily_used, limit: data.automation_runs_daily_limit },
        { label: 'Lead Exports This Month', used: data.leads_exported_month, limit: data.leads_export_limit },
    ];
    const prompts = buildUsagePrompts(data);

    return (
        <div className="space-y-6">
            <div className="bg-white rounded-lg border shadow-sm p-6">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Plan & Usage</h1>
                        <p className="text-sm text-gray-500">{data.plan_name} package, {data.subscription_status.toLowerCase()}</p>
                    </div>
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-indigo-100 text-indigo-800">
                        {data.plan_id}
                    </span>
                </div>

                <div className="space-y-4">
                    {rows.map((row) => {
                        const isUnlimited = row.limit == null;
                        const limitValue = row.limit ?? 0;
                        const pct = !isUnlimited && limitValue > 0 ? (row.used / limitValue) * 100 : 0;
                        const isBlocked = !isUnlimited && (limitValue === 0 ? row.used > 0 : row.used >= limitValue);
                        const displayLimit = isUnlimited ? 'Unlimited' : row.limit;
                        return (
                            <div key={row.label}>
                                <div className="flex justify-between text-sm font-medium mb-1">
                                    <span>{row.label}</span>
                                    <span className={isBlocked ? 'text-red-600' : 'text-gray-600'}>
                                        {row.used} / {displayLimit}
                                    </span>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-3">
                                    <div
                                        className={`h-3 rounded-full ${isBlocked ? 'bg-red-500' : 'bg-indigo-600'}`}
                                        style={{ width: `${Math.min(pct, 100)}%` }}
                                    />
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8">
                    <MetricCard icon={<Activity className="h-5 w-5 text-gray-400" />} label="Leads Captured" value={String(data.leads_captured_month)} />
                    <MetricCard icon={<Zap className="h-5 w-5 text-amber-500" />} label="High-Intent Leads" value={String(data.high_intent_leads_month)} />
                    <MetricCard icon={<Activity className="h-5 w-5 text-emerald-500" />} label="Converted Leads" value={String(data.converted_leads_month)} />
                    <MetricCard icon={<Activity className="h-5 w-5 text-sky-500" />} label="Contacted Leads" value={String(data.contacted_leads_month)} />
                    <MetricCard icon={<Activity className="h-5 w-5 text-indigo-500" />} label="Conversion Rate" value={`${(data.conversion_rate_month * 100).toFixed(1)}%`} />
                    <MetricCard icon={<Activity className="h-5 w-5 text-rose-500" />} label="Reported Deal Value" value={currency(data.estimated_revenue_month)} />
                </div>
                <div className="mt-4 text-sm text-gray-500">
                    Avg follow-up speed: {data.avg_follow_up_hours_month != null ? `${data.avg_follow_up_hours_month.toFixed(1)} hours` : 'Not enough followed-up leads yet'}
                </div>
                <div className="mt-2 text-sm text-gray-500">
                    Automatic lead extension: {data.lead_auto_extension_enabled ? 'On' : 'Off'} · next reset {new Date(data.lead_next_reset_at).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' })}
                </div>
            </div>

            {prompts.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded p-6">
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <h2 className="text-lg font-semibold text-amber-800 mb-3">Upgrade Opportunities</h2>
                            <div className="space-y-2 text-sm text-amber-900">
                                {prompts.map((item) => (
                                    <div key={item.title}>
                                        <strong>{item.title}:</strong> {item.message}
                                    </div>
                                ))}
                            </div>
                        </div>
                        <Link to="/billing" className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900">
                            Open Billing
                            <ArrowUpRight className="h-4 w-4" />
                        </Link>
                    </div>
                </div>
            )}

            <div className="bg-white rounded-lg border shadow-sm p-6">
                <h2 className="text-lg font-medium text-gray-900 mb-4">Locked Or Metered Features</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    {Object.entries(data.features).map(([feature, enabled]) => (
                        <div key={feature} className="flex items-center justify-between rounded border px-3 py-2">
                            <span className="capitalize">{feature.replace(/([A-Z])/g, ' $1').trim()}</span>
                            <span className={enabled ? 'text-emerald-600 font-semibold' : 'text-gray-400 font-semibold'}>
                                {enabled ? 'Enabled' : 'Locked'}
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            {data.blocked.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded p-6">
                    <h2 className="text-lg font-semibold text-amber-800 mb-3">Plan Limits Reached</h2>
                    <div className="space-y-2 text-sm text-amber-900">
                        {data.blocked.map((item) => (
                            <div key={item.code}>{item.message}</div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

function MetricCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
    return (
        <div className="p-4 bg-gray-50 rounded border">
            <div className="flex items-center space-x-3 mb-2">
                {icon}
                <span className="text-sm font-medium text-gray-600">{label}</span>
            </div>
            <div className="text-2xl font-bold">{value}</div>
        </div>
    );
}
