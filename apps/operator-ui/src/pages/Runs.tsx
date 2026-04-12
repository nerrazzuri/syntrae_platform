import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Client } from '../lib/api';
import { Play, CheckCircle, AlertTriangle, XCircle, Clock, Activity } from 'lucide-react';

export function Runs() {
    const [runs, setRuns] = useState<any[]>([]);
    const [health, setHealth] = useState<any | null>(null);
    const [loading, setLoading] = useState(true);
    const [selectedRun, setSelectedRun] = useState<any | null>(null);

    const loadData = async () => {
        try {
            setLoading(true);
            const data = await Client.get('/runs');
            setRuns(data.runs || []);
            setHealth(data.health || null);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr);
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
    };

    const statusBadge = (status: string) => {
        const styles: Record<string, { bg: string; icon: any }> = {
            COMPLETED: { bg: 'bg-emerald-100 text-emerald-700', icon: <CheckCircle className="h-4 w-4" /> },
            DEGRADED: { bg: 'bg-amber-100 text-amber-700', icon: <AlertTriangle className="h-4 w-4" /> },
            FAILED: { bg: 'bg-rose-100 text-rose-700', icon: <XCircle className="h-4 w-4" /> },
            RUNNING: { bg: 'bg-sky-100 text-sky-700', icon: <Play className="h-4 w-4" /> },
            PENDING: { bg: 'bg-slate-100 text-slate-700', icon: <Clock className="h-4 w-4" /> },
        };
        const style = styles[status] || styles.PENDING;
        return <span className={`status-pill ${style.bg}`}>{style.icon}{status}</span>;
    };

    return (
        <div className="space-y-6">
            <section className="panel p-6 lg:p-8">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <div className="hero-kicker">Automation Runs</div>
                        <h1 className="hero-title mt-3">See what the workers touched, skipped, retried, and emitted.</h1>
                        <p className="hero-copy">
                            This is the operating console for discovery health. Cooldown skips, retries, and worker status are visible here by run.
                        </p>
                    </div>
                    <div className="panel-strong flex items-center gap-3 px-5 py-4">
                        <Activity className="h-5 w-5 text-teal-700" />
                        <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Run Records</div>
                            <div className="mt-1 text-2xl font-bold text-slate-900">{runs.length}</div>
                        </div>
                    </div>
                </div>
            </section>

            {health && (
                <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <SummaryCard label="Active Workers" value={health.active_workers || 0} tone="teal" />
                    <SummaryCard label="Stale Retries" value={health.stale_retries || 0} tone="rose" />
                </section>
            )}

            <section className="table-shell overflow-x-auto">
                {loading ? (
                    <div className="p-8 text-slate-500">Loading runs...</div>
                ) : runs.length === 0 ? (
                    <div className="p-10 text-center text-slate-400">Automation runs will appear here once discovery is triggered.</div>
                ) : (
                    <table className="min-w-full">
                        <thead className="table-head border-b border-slate-200">
                            <tr>
                                <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Run ID</th>
                                <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Brand</th>
                                <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Status</th>
                                <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Source Posts</th>
                                <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Comments</th>
                                <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Worker</th>
                                <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Started</th>
                                <th className="px-4 py-4"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {runs.map(run => {
                                const stats = run.stats || {};
                                return (
                                    <tr
                                        key={run.id}
                                        className="table-row cursor-pointer border-b border-slate-100"
                                        onClick={() => setSelectedRun(run)}
                                    >
                                        <td className="px-4 py-4 font-mono text-xs text-slate-500">{run.id.substring(0, 10)}...</td>
                                        <td className="px-4 py-4 text-sm font-semibold text-slate-800">{run.brand_name || 'Unknown'}</td>
                                        <td className="px-4 py-4 text-sm">{statusBadge(run.status)}</td>
                                        <td className="px-4 py-4 text-sm text-slate-700">{stats.videos_processed || 0}</td>
                                        <td className="px-4 py-4 text-sm text-slate-700">
                                            <div>Captured: {stats.comments_captured || 0}</div>
                                            <div className="text-xs text-slate-500">
                                                Emitted: {stats.comments_emitted_success || 0}
                                                {stats.comments_emitted_failed > 0 && ` / ${stats.comments_emitted_failed} failed`}
                                            </div>
                                        </td>
                                        <td className="px-4 py-4 text-sm text-slate-700">
                                            <div>{run.claimed_by || '-'}</div>
                                            <div className="text-xs text-slate-500">{run.worker_health}</div>
                                        </td>
                                        <td className="px-4 py-4 text-sm whitespace-nowrap text-slate-500">{formatDate(run.started_at)}</td>
                                        <td className="px-4 py-4 text-right">
                                            <button className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-teal-700 transition hover:bg-teal-50">
                                                View
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </section>

            {selectedRun && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"
                    onClick={() => setSelectedRun(null)}
                >
                    <div
                        className="panel-strong max-h-[85vh] w-full max-w-4xl overflow-auto"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="border-b border-slate-200 p-6">
                            <div className="hero-kicker">Run Detail</div>
                            <h3 className="mt-2 text-xl font-bold">Automation execution record</h3>
                        </div>
                        <div className="space-y-5 p-6">
                            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                <DetailPanel label="Run ID" value={<div className="font-mono text-sm">{selectedRun.id}</div>} />
                                <DetailPanel label="Status" value={statusBadge(selectedRun.status)} />
                                <DetailPanel label="Platform" value={<span className="uppercase">{selectedRun.platform}</span>} />
                                <DetailPanel label="Brand ID" value={<div className="font-mono text-sm">{selectedRun.brand_id}</div>} />
                                <DetailPanel label="Worker" value={selectedRun.claimed_by || '-'} />
                                <DetailPanel label="Worker Health" value={selectedRun.worker_health || 'IDLE'} />
                                <DetailPanel label="Retry Attempts" value={Math.max((selectedRun.attempt_count || 0) - 1, 0)} />
                                <DetailPanel label="Last Error" value={selectedRun.last_error || '-'} />
                            </div>

                            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                                <MetricBox label="Source Posts Reviewed" value={selectedRun.stats?.videos_processed || 0} tone="sky" />
                                <MetricBox label="Comments Captured" value={selectedRun.stats?.comments_captured || 0} tone="amber" />
                                <MetricBox label="Successfully Emitted" value={selectedRun.stats?.comments_emitted_success || 0} tone="green" />
                                <MetricBox label="Emission Failures" value={selectedRun.stats?.comments_emitted_failed || 0} tone="rose" />
                            </div>

                            {selectedRun.abort_reason && (
                                <div className="rounded-3xl border border-amber-200 bg-amber-50 p-4">
                                    <div className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">Abort Reason</div>
                                    <div className="mt-2 text-sm text-amber-900">{selectedRun.abort_reason}</div>
                                </div>
                            )}

                            <div className="grid gap-4 md:grid-cols-3">
                                <DetailPanel label="Started At" value={formatDate(selectedRun.started_at)} />
                                <DetailPanel label="Last Heartbeat" value={selectedRun.heartbeat_at ? formatDate(selectedRun.heartbeat_at) : '-'} />
                                <DetailPanel label="Ended At" value={selectedRun.ended_at ? formatDate(selectedRun.ended_at) : '-'} />
                            </div>
                        </div>
                        <div className="border-t border-slate-200 p-6 text-right">
                            <button
                                onClick={() => setSelectedRun(null)}
                                className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: 'teal' | 'amber' | 'sky' | 'rose' }) {
    const toneStyles: Record<string, string> = {
        teal: 'from-teal-500/20 to-emerald-500/10',
        amber: 'from-amber-500/20 to-orange-500/10',
        sky: 'from-sky-500/20 to-cyan-500/10',
        rose: 'from-rose-500/20 to-pink-500/10',
    };

    return (
        <div className={`metric-panel bg-gradient-to-br ${toneStyles[tone]}`}>
            <div className="text-sm font-semibold text-slate-500">{label}</div>
            <div className="mt-2 text-3xl font-bold text-slate-900">{value}</div>
        </div>
    );
}

function DetailPanel({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="panel p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">{label}</div>
            <div className="mt-3 text-slate-800">{value}</div>
        </div>
    );
}

function MetricBox({ label, value, tone }: { label: string; value: number; tone: 'sky' | 'amber' | 'green' | 'rose' }) {
    const toneStyles: Record<string, string> = {
        sky: 'bg-sky-50 text-sky-900 border-sky-100',
        amber: 'bg-amber-50 text-amber-900 border-amber-100',
        green: 'bg-emerald-50 text-emerald-900 border-emerald-100',
        rose: 'bg-rose-50 text-rose-900 border-rose-100',
    };

    return (
        <div className={`rounded-3xl border p-5 ${toneStyles[tone]}`}>
            <div className="text-xs font-semibold uppercase tracking-[0.24em] opacity-75">{label}</div>
            <div className="mt-2 text-3xl font-bold">{value}</div>
        </div>
    );
}
