import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { Users, Zap, Target, TrendingUp, Gauge } from 'lucide-react';

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
    const [range, setRange] = useState('30');

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

    if (loading && !data) {
        return <div className="panel p-8 text-slate-500">Loading dashboard...</div>;
    }

    const metrics = data?.global;
    const totalLeads = metrics?.total_leads || 0;

    return (
        <div className="space-y-6">
            <section className="panel overflow-hidden">
                <div className="grid gap-6 p-6 lg:grid-cols-[1.3fr_0.7fr] lg:p-8">
                    <div>
                        <div className="hero-kicker">Performance Overview</div>
                        <h1 className="hero-title mt-3">Track demand, filter noise, and act on the comments that matter.</h1>
                        <p className="hero-copy">
                            This workspace view prioritizes buyer-signal clarity: how much intent is surfacing, how much is worth immediate outreach,
                            and whether your automation is converting attention into real pipeline.
                        </p>
                    </div>

                    <div className="panel-strong p-5">
                        <div className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">Window</div>
                        <select
                            value={range}
                            onChange={e => setRange(e.target.value)}
                            className="surface-input mt-3"
                        >
                            <option value="7">Last 7 Days</option>
                            <option value="30">Last 30 Days</option>
                            <option value="90">Last 90 Days</option>
                        </select>

                        <div className="mt-5 grid grid-cols-2 gap-3">
                            <QuickStat label="Avg Confidence" value={`${((metrics?.avg_confidence || 0) * 100).toFixed(0)}%`} />
                            <QuickStat label="Ready Share" value={`${totalLeads > 0 ? Math.round(((metrics?.ready_leads || 0) / totalLeads) * 100) : 0}%`} />
                        </div>
                    </div>
                </div>
            </section>

            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard title="Total Leads" value={metrics?.total_leads} icon={<Users className="h-4 w-4 text-slate-500" />} accent="teal" />
                <MetricCard title="Qualified Ready" value={metrics?.ready_leads} icon={<Target className="h-4 w-4 text-teal-700" />} accent="green" />
                <MetricCard title="Conversion Rate" value={`${((metrics?.conversion_rate || 0) * 100).toFixed(1)}%`} icon={<TrendingUp className="h-4 w-4 text-amber-600" />} accent="amber" />
                <MetricCard title="Priority DMs" value={metrics?.priority_dm} icon={<Zap className="h-4 w-4 text-rose-600" />} accent="rose" />
            </section>

            <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="panel p-6">
                    <div className="flex items-center gap-2">
                        <Gauge className="h-5 w-5 text-teal-700" />
                        <h2 className="text-xl font-bold">Lead Quality Distribution</h2>
                    </div>
                    <p className="mt-2 text-sm text-slate-500">
                        A quick operating view of how much of the captured signal is immediately actionable.
                    </p>
                    <div className="mt-6 space-y-5">
                        <ProgressBar label="Ready to Buy" value={metrics?.ready_leads || 0} total={totalLeads || 1} color="from-teal-600 to-emerald-500" />
                        <ProgressBar label="Priority Outreach Needed" value={metrics?.priority_dm || 0} total={totalLeads || 1} color="from-amber-500 to-orange-500" />
                    </div>
                </div>

                <div className="panel p-6">
                    <div className="hero-kicker">Operator Notes</div>
                    <h2 className="mt-3 text-2xl font-bold">What this number set should tell you</h2>
                    <div className="mt-5 space-y-4 text-sm text-slate-600">
                        <p>If conversion is flat while total leads rise, your automation is collecting more surface-level curiosity than true purchase intent.</p>
                        <p>If priority DMs stay high, the current market fit is strong enough to justify faster manual follow-up.</p>
                        <p>If average confidence drops, review suppression, run quality, and source comments before widening automation volume.</p>
                    </div>
                </div>
            </section>
        </div>
    );
};

const MetricCard = ({ title, value, icon, accent }: any) => {
    const accentStyles: Record<string, string> = {
        teal: 'from-teal-500/20 to-cyan-500/10',
        green: 'from-emerald-500/20 to-lime-500/10',
        amber: 'from-amber-500/20 to-orange-500/10',
        rose: 'from-rose-500/20 to-pink-500/10',
    };

    return (
        <div className={`metric-panel bg-gradient-to-br ${accentStyles[accent] || accentStyles.teal}`}>
            <div className="flex items-start justify-between gap-4">
                <div>
                    <div className="text-sm font-semibold text-slate-500">{title}</div>
                    <div className="mt-3 text-3xl font-bold text-slate-900">{value ?? '-'}</div>
                </div>
                <div className="rounded-2xl border border-white/70 bg-white/70 p-3">
                    {icon}
                </div>
            </div>
        </div>
    );
};

const QuickStat = ({ label, value }: { label: string; value: string }) => (
    <div className="rounded-2xl border border-slate-200 bg-white/70 p-4">
        <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">{label}</div>
        <div className="mt-2 text-xl font-bold text-slate-900">{value}</div>
    </div>
);

const ProgressBar = ({ label, value, total, color }: any) => {
    const pct = total > 0 ? (value / total) * 100 : 0;
    return (
        <div>
            <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-semibold text-slate-700">{label}</span>
                <span className="text-slate-500">{value} ({pct.toFixed(0)}%)</span>
            </div>
            <div className="h-3 w-full rounded-full bg-slate-200/80">
                <div
                    className={`h-3 rounded-full bg-gradient-to-r ${color}`}
                    style={{ width: `${pct}%` }}
                />
            </div>
        </div>
    );
};
