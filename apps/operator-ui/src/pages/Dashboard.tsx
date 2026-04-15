import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Users, Zap, Target, TrendingUp, Gauge, Wallet, Clock3, ArrowUpRight } from 'lucide-react';

interface OverviewMetrics {
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

interface OverviewData {
    global: OverviewMetrics;
    brands: Record<string, OverviewMetrics>;
}

interface UsageData {
    plan_id: string;
    plan_name: string;
    automation_runs_daily_used: number;
    automation_runs_daily_limit: number | null;
    brands_used: number;
    brands_limit: number;
    leads_captured_month: number;
    leads_rollover_month: number;
    leads_captured_limit: number;
    lead_auto_extension_enabled: boolean;
    lead_warning_threshold: number;
    lead_overage_block_size: number;
    lead_overage_block_price_minor: number;
    lead_overage_currency: string;
    features: Record<string, boolean>;
    blocked: Array<{ code: string; message: string }>;
}

function currency(value: number) {
    return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR', maximumFractionDigits: 0 }).format(value || 0);
}

function buildPrompts(metrics: OverviewMetrics | undefined, usage: UsageData | null) {
    if (!metrics || !usage) return [];

    const prompts: Array<{ title: string; message: string; cta: string }> = [];

    if (!usage.features.exportEnabled && metrics.high_intent_leads >= 3) {
        prompts.push({
            title: 'Unlock lead export',
            message: `You already have ${metrics.high_intent_leads} high-intent leads in this window. Upgrade to Growth to export qualified leads and work them outside the console.`,
            cta: 'Upgrade to Growth',
        });
    }

    if (!usage.features.assistedReplyDrafts && metrics.ready_leads >= 3) {
        prompts.push({
            title: 'Draft replies faster',
            message: `${metrics.ready_leads} ready leads are waiting for operator follow-up. Upgrade to Growth to unlock assisted reply drafting and reduce manual response time.`,
            cta: 'Unlock assisted drafting',
        });
    }

    if (usage.automation_runs_daily_limit != null && usage.automation_runs_daily_used >= Math.max(1, Math.floor(usage.automation_runs_daily_limit * 0.8)) && usage.plan_id !== 'PRO' && usage.plan_id !== 'AGENCY') {
        prompts.push({
            title: 'Scale daily automation volume',
            message: `This workspace is using ${usage.automation_runs_daily_used}/${usage.automation_runs_daily_limit} automation runs today. Upgrade to Pro for higher daily automation capacity and multi-brand workflows.`,
            cta: 'Upgrade to Pro',
        });
    }

    if (usage.brands_limit > 0 && usage.brands_used >= usage.brands_limit && usage.plan_id !== 'PRO' && usage.plan_id !== 'AGENCY') {
        prompts.push({
            title: 'Add more brands',
            message: `You are at the ${usage.plan_name} brand limit. Upgrade to Pro to run multiple brands under one workspace.`,
            cta: 'Expand to Pro',
        });
    }

    if (usage.leads_captured_limit > 0 && usage.leads_captured_month >= Math.max(1, Math.floor(usage.leads_captured_limit * usage.lead_warning_threshold))) {
        prompts.push({
            title: 'Lead quota is nearly full',
            message: `This workspace is at ${usage.leads_captured_month}/${usage.leads_captured_limit} monthly leads. New lead capture stops at the monthly limit, so upgrade before this month’s allowance is exhausted.`,
            cta: 'Review billing controls',
        });
    }

    return prompts.slice(0, 3);
}

export const Dashboard = () => {
    const [data, setData] = useState<OverviewData | null>(null);
    const [usage, setUsage] = useState<UsageData | null>(null);
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
            start.setDate(end.getDate() - parseInt(range, 10));

            const [overviewRes, usageRes] = await Promise.all([
                api.analytics.getOverview({
                    from: start.toISOString(),
                    to: end.toISOString()
                }),
                api.analytics.getUsage(),
            ]);
            setData(overviewRes);
            setUsage(usageRes);
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
    const prompts = buildPrompts(metrics, usage);

    return (
        <div className="space-y-6">
            <section className="panel overflow-hidden">
                <div className="grid gap-6 p-6 lg:grid-cols-[1.3fr_0.7fr] lg:p-8">
                    <div>
                        <div className="hero-kicker">Commercial Overview</div>
                        <h1 className="hero-title mt-3">Track pipeline, follow-up speed, and revenue from comment-driven leads.</h1>
                        <p className="hero-copy">
                            This workspace view separates capture activity from commercial outcomes: captured-lead metrics use capture date,
                            follow-up metrics use follow-up date, and revenue metrics use conversion date.
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
                            <QuickStat label="Follow-up Speed" value={metrics?.avg_follow_up_hours != null ? `${metrics.avg_follow_up_hours.toFixed(1)}h` : 'Not tracked'} />
                        </div>
                    </div>
                </div>
            </section>

            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
                <MetricCard title="Leads Captured" value={metrics?.total_leads} icon={<Users className="h-4 w-4 text-slate-500" />} accent="teal" />
                <MetricCard title="High-Intent Leads" value={metrics?.high_intent_leads} icon={<Target className="h-4 w-4 text-teal-700" />} accent="green" />
                <MetricCard title="Contacted" value={metrics?.contacted_leads} icon={<Zap className="h-4 w-4 text-indigo-700" />} accent="indigo" />
                <MetricCard title="Qualified" value={metrics?.qualified_leads} icon={<Gauge className="h-4 w-4 text-amber-700" />} accent="amber" />
                <MetricCard title="Converted" value={metrics?.converted_leads} icon={<TrendingUp className="h-4 w-4 text-emerald-700" />} accent="emerald" />
                <MetricCard title="Deal Value" value={currency(metrics?.estimated_revenue || 0)} icon={<Wallet className="h-4 w-4 text-rose-700" />} accent="rose" />
            </section>

            <section className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
                <div className="panel p-6">
                    <div className="flex items-center gap-2">
                        <Clock3 className="h-5 w-5 text-teal-700" />
                        <h2 className="text-xl font-bold">Pipeline Health</h2>
                    </div>
                    <p className="mt-2 text-sm text-slate-500">
                        Conversion rate below is based on leads that were worked or closed in this window, not just leads classified as ready.
                    </p>
                    <div className="mt-6 space-y-5">
                        <ProgressBar label="High-intent share" value={metrics?.high_intent_leads || 0} total={metrics?.total_leads || 1} color="from-teal-600 to-emerald-500" />
                        <ProgressBar label="Contacted share" value={metrics?.contacted_leads || 0} total={metrics?.total_leads || 1} color="from-indigo-600 to-sky-500" />
                        <ProgressBar label="Real conversion rate" value={metrics?.converted_leads || 0} total={metrics?.total_leads || 1} color="from-amber-500 to-orange-500" />
                    </div>
                </div>

                <div className="panel p-6">
                    <div className="hero-kicker">Operator Notes</div>
                    <h2 className="mt-3 text-2xl font-bold">Commercial interpretation</h2>
                    <div className="mt-5 space-y-4 text-sm text-slate-600">
                        <p>If high-intent leads are rising but contacted leads are flat, the issue is follow-up capacity rather than discovery quality.</p>
                        <p>If contacted leads are healthy but conversions stay low, review qualification standards, replies, and offer fit before increasing automation volume.</p>
                        <p>Track deal value manually at first. It gives you a real revenue signal without waiting for a full CRM integration.</p>
                    </div>
                    <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                        <div className="font-semibold text-slate-900">Real conversion rate</div>
                        <div className="mt-1">{`${(((metrics?.conversion_rate || 0) * 100)).toFixed(1)}% of leads worked or closed in this window are recorded as converted.`}</div>
                    </div>
                </div>
            </section>

            {prompts.length > 0 && (
                <section className="panel p-6">
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <div className="hero-kicker">Upgrade Opportunities</div>
                            <h2 className="mt-2 text-2xl font-bold">Commercial prompts based on current usage</h2>
                        </div>
                        <Link to="/billing" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                            Open Billing
                            <ArrowUpRight className="h-4 w-4" />
                        </Link>
                    </div>
                    <div className="mt-6 grid gap-4 md:grid-cols-3">
                        {prompts.map((prompt) => (
                            <div key={prompt.title} className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
                                <div className="text-sm font-semibold text-amber-900">{prompt.title}</div>
                                <p className="mt-3 text-sm leading-6 text-amber-800">{prompt.message}</p>
                                <Link to="/billing" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-amber-900">
                                    {prompt.cta}
                                    <ArrowUpRight className="h-4 w-4" />
                                </Link>
                            </div>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
};

const MetricCard = ({ title, value, icon, accent }: any) => {
    const accentStyles: Record<string, string> = {
        teal: 'from-teal-500/20 to-cyan-500/10',
        green: 'from-emerald-500/20 to-lime-500/10',
        amber: 'from-amber-500/20 to-orange-500/10',
        rose: 'from-rose-500/20 to-pink-500/10',
        indigo: 'from-indigo-500/20 to-blue-500/10',
        emerald: 'from-emerald-500/20 to-teal-500/10',
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
                <div className={`h-3 rounded-full bg-gradient-to-r ${color}`} style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
};
