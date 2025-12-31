
import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { Users, Zap, Target, TrendingUp } from 'lucide-react';

interface OverviewData {
    global: {
        total_leads: number;
        ready_leads: number;
        conversion_rate: number;
        priority_dm: number;
        avg_confidence: number;
    };
    brands: Record<string, any>;
}

export const Dashboard = () => {
    const [data, setData] = useState<OverviewData | null>(null);
    const [loading, setLoading] = useState(true);
    const [range, setRange] = useState('30'); // Days

    useEffect(() => {
        loadData();
    }, [range]);

    const loadData = async () => {
        setLoading(true);
        try {
            const end = new Date();
            const start = new Date();
            start.setDate(end.getDate() - parseInt(range));

            const res = await api.analytics.getOverview({
                from: start.toISOString(),
                to: end.toISOString()
            });
            setData(res);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    if (loading && !data) return <div className="p-8">Loading dashboard...</div>;

    const metrics = data?.global;

    return (
        <div className="space-y-8">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
                <select
                    value={range}
                    onChange={e => setRange(e.target.value)}
                    className="bg-white border rounded-md px-3 py-1 text-sm shadow-sm"
                >
                    <option value="7">Last 7 Days</option>
                    <option value="30">Last 30 Days</option>
                    <option value="90">Last 90 Days</option>
                </select>
            </div>

            {/* KPI Grid */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card title="Total Leads" value={metrics?.total_leads} icon={<Users className="h-4 w-4 text-gray-500" />} />
                <Card title="Qualified (Ready)" value={metrics?.ready_leads} icon={<Target className="h-4 w-4 text-blue-500" />} />
                <Card title="Conversion Rate" value={`${((metrics?.conversion_rate || 0) * 100).toFixed(1)}%`} icon={<TrendingUp className="h-4 w-4 text-green-500" />} />
                <Card title="Priority DMs" value={metrics?.priority_dm} icon={<Zap className="h-4 w-4 text-amber-500" />} />
            </div>

            {/* Simple Visual Representation (Proxy for Chart) */}
            <div className="bg-white p-6 rounded-lg border shadow-sm">
                <h3 className="text-lg font-medium mb-4">Lead Quality Distribution</h3>
                <div className="space-y-4">
                    <ProgressBar label="Ready (High Intent)" value={metrics?.ready_leads || 0} total={metrics?.total_leads || 1} color="bg-blue-600" />
                    <ProgressBar label="Priority Action Needed" value={metrics?.priority_dm || 0} total={metrics?.total_leads || 1} color="bg-amber-500" />
                </div>
            </div>
        </div>
    );
};

const Card = ({ title, value, icon }: any) => (
    <div className="p-6 bg-white rounded-lg border shadow-sm">
        <div className="flex flex-row items-center justify-between space-y-0 pb-2">
            <h3 className="text-sm font-medium text-gray-500">{title}</h3>
            {icon}
        </div>
        <div className="text-2xl font-bold">{value ?? '-'}</div>
    </div>
);

const ProgressBar = ({ label, value, total, color }: any) => {
    const pct = total > 0 ? (value / total) * 100 : 0;
    return (
        <div>
            <div className="flex justify-between text-sm mb-1">
                <span>{label}</span>
                <span className="text-gray-500">{value} ({pct.toFixed(0)}%)</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div className={`${color} h-2.5 rounded-full`} style={{ width: `${pct}%` }}></div>
            </div>
        </div>
    );
};
