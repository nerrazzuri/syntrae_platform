
import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { Zap, Activity } from 'lucide-react';

interface UsageData {
    plan_id: string;
    brands_used: number;
    brands_limit: number;
    drafts_generated_month: number;
    leads_captured_month: number;
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

    const pct = data ? (data.brands_used / data.brands_limit) * 100 : 0;
    const isOverLimit = data && data.brands_used > data.brands_limit;

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold tracking-tight">Plan & Usage</h1>

            <div className="bg-white rounded-lg border shadow-sm p-6">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className="text-lg font-medium text-gray-900">Current Plan</h2>
                        <p className="text-sm text-gray-500">Your subscription usage and limits.</p>
                    </div>
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-indigo-100 text-indigo-800">
                        {data?.plan_id}
                    </span>
                </div>

                <div className="space-y-6">
                    {/* Brand Limit */}
                    <div>
                        <div className="flex justify-between text-sm font-medium mb-1">
                            <span>Active Brands</span>
                            <span className={isOverLimit ? 'text-red-600' : 'text-gray-600'}>
                                {data?.brands_used} / {data?.brands_limit}
                            </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-3">
                            <div
                                className={`h-3 rounded-full ${isOverLimit ? 'bg-red-500' : 'bg-indigo-600'}`}
                                style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                        </div>
                        {isOverLimit && (
                            <p className="text-xs text-red-500 mt-1">You are over your plan limit. Please upgrade or pause brands.</p>
                        )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
                        <div className="p-4 bg-gray-50 rounded border">
                            <div className="flex items-center space-x-3 mb-2">
                                <Activity className="h-5 w-5 text-gray-400" />
                                <span className="text-sm font-medium text-gray-600">Leads (This Month)</span>
                            </div>
                            <div className="text-2xl font-bold">{data?.leads_captured_month}</div>
                        </div>
                        <div className="p-4 bg-gray-50 rounded border">
                            <div className="flex items-center space-x-3 mb-2">
                                <Zap className="h-5 w-5 text-amber-500" />
                                <span className="text-sm font-medium text-gray-600">Drafts Generated</span>
                            </div>
                            <div className="text-2xl font-bold">{data?.drafts_generated_month}</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
