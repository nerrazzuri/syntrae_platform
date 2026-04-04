import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Activity, Zap } from 'lucide-react';

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
    automation_runs_daily_limit: number;
    leads_exported_month: number;
    leads_export_limit: number;
    drafts_generated_month: number;
    leads_captured_month: number;
    features: Record<string, boolean>;
    blocked: Array<{ code: string; message: string }>;
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
        { label: 'Active Brands', used: data.brands_used, limit: data.brands_limit },
        { label: 'Team Members', used: data.team_members_used, limit: data.team_members_limit },
        { label: 'Events Today', used: data.events_daily_used, limit: data.events_daily_limit },
        { label: 'Events This Month', used: data.events_monthly_used, limit: data.events_monthly_limit },
        { label: 'Suggestions Today', used: data.suggestions_daily_used, limit: data.suggestions_daily_limit },
        { label: 'Automation Runs Today', used: data.automation_runs_daily_used, limit: data.automation_runs_daily_limit },
        { label: 'Lead Exports This Month', used: data.leads_exported_month, limit: data.leads_export_limit },
    ];

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
                        const pct = row.limit > 0 ? (row.used / row.limit) * 100 : 0;
                        const isBlocked = row.limit === 0 ? row.used > 0 : row.used >= row.limit;
                        return (
                            <div key={row.label}>
                                <div className="flex justify-between text-sm font-medium mb-1">
                                    <span>{row.label}</span>
                                    <span className={isBlocked ? 'text-red-600' : 'text-gray-600'}>
                                        {row.used} / {row.limit}
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

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
                    <div className="p-4 bg-gray-50 rounded border">
                        <div className="flex items-center space-x-3 mb-2">
                            <Activity className="h-5 w-5 text-gray-400" />
                            <span className="text-sm font-medium text-gray-600">Leads Captured</span>
                        </div>
                        <div className="text-2xl font-bold">{data.leads_captured_month}</div>
                    </div>
                    <div className="p-4 bg-gray-50 rounded border">
                        <div className="flex items-center space-x-3 mb-2">
                            <Zap className="h-5 w-5 text-amber-500" />
                            <span className="text-sm font-medium text-gray-600">Drafts Generated</span>
                        </div>
                        <div className="text-2xl font-bold">{data.drafts_generated_month}</div>
                    </div>
                </div>
            </div>

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
                    <h2 className="text-lg font-semibold text-amber-800 mb-3">Upgrade Needed</h2>
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
