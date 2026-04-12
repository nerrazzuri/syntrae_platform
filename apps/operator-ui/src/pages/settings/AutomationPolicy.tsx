
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';

interface Policy {
    id: string;
    version: number;
    status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'DRAFT';
    mode: 'SAFE' | 'BALANCED' | 'AGGRESSIVE';
    enabled: boolean;
    relevance_min_score: number;
    intent_min_score: number;
    max_videos_per_hour: number;
    max_comments_per_video: number;
    max_comments_per_hour: number;
    max_leads_per_day: number;
    max_source_posts_per_run: number;
    max_comments_per_source_post: number;
    cooldown_ms_between_actions: number;
    allow_capture_seen_events: boolean;
    notes?: string;
}

interface PolicyUpdatePayload {
    status: Policy['status'];
    mode: Policy['mode'];
    enabled: boolean;
    relevance_min_score: number;
    intent_min_score: number;
    max_source_posts_per_run: number;
    max_comments_per_source_post: number;
    cooldown_ms_between_actions: number;
    allow_capture_seen_events: boolean;
    notes?: string;
}

function statusBadge(status: Policy['status']) {
    if (status === 'ACTIVE') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
    if (status === 'PAUSED') return 'bg-amber-100 text-amber-800 border-amber-200';
    if (status === 'DRAFT') return 'bg-slate-100 text-slate-700 border-slate-200';
    return 'bg-slate-100 text-slate-500 border-slate-200';
}

function modeLabel(mode: Policy['mode']) {
    if (mode === 'SAFE') return 'Lower-risk capture profile with tighter decision gates.';
    if (mode === 'BALANCED') return 'Balanced policy for routine discovery and lead qualification.';
    return 'Higher-volume mode with looser capture thresholds.';
}

function numberValue(value: string) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

export const AutomationPolicySettings: React.FC = () => {
    const { brandId } = useParams<{ brandId: string }>();
    const [policy, setPolicy] = useState<Policy | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    useEffect(() => {
        if (!brandId) return;
        loadPolicy();
    }, [brandId]);

    const loadPolicy = async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await api.get(`/brands/${brandId}/automation-policy`);
            setPolicy(data);
        } catch (err) {
            console.error(err);
            setError("Failed to load policy");
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        if (!brandId || !policy) return;
        try {
            setSaving(true);
            setError(null);
            setNotice(null);

            const payload: PolicyUpdatePayload = {
                status: policy.status,
                mode: policy.mode,
                enabled: policy.enabled,
                relevance_min_score: clamp(policy.relevance_min_score, 0, 100),
                intent_min_score: clamp(policy.intent_min_score, 0, 100),
                max_source_posts_per_run: clamp(policy.max_source_posts_per_run, 1, 60),
                max_comments_per_source_post: clamp(policy.max_comments_per_source_post, 1, 10),
                cooldown_ms_between_actions: Math.max(0, policy.cooldown_ms_between_actions),
                allow_capture_seen_events: policy.allow_capture_seen_events,
                notes: policy.notes?.trim() || undefined,
            };

            const updated = await api.put(`/brands/${brandId}/automation-policy`, payload);
            setPolicy(updated);
            setNotice(`Policy saved. Version ${updated.version} is now the current automation policy.`);
        } catch (err: any) {
            console.error(err);
            setError(err.response?.data?.error || "Failed to save policy");
        } finally {
            setSaving(false);
        }
    };

    const handleChange = (field: keyof Policy, value: any) => {
        if (!policy) return;
        setPolicy({ ...policy, [field]: value });
    };

    if (loading) {
        return <div className="p-8 text-slate-600">Loading automation policy...</div>;
    }
    if (!policy) {
        return <div className="p-8 text-slate-600">No automation policy found.</div>;
    }

    return (
        <div className="mx-auto max-w-6xl px-6 py-8">
            <div className="rounded-3xl border border-slate-200 bg-[linear-gradient(135deg,#eff6ff,#ffffff_55%,#f8fafc)] p-8 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Brand Safety Controls</div>
                <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="max-w-3xl">
                        <h1 className="text-3xl font-bold text-slate-900">Automation Policy</h1>
                        <p className="mt-3 text-sm leading-6 text-slate-600">
                            Control how aggressively Syntrae discovers content, filters relevance, and caps capture volume for this brand.
                            Each save creates a new current policy version so run behavior stays auditable.
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${statusBadge(policy.status)}`}>
                            {policy.status}
                        </span>
                        <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                            {policy.mode} MODE
                        </span>
                        <button
                            onClick={() => {
                                setNotice(null);
                                handleChange('status', policy.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE');
                            }}
                            className={`inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-semibold text-white transition ${
                                policy.status === 'ACTIVE'
                                    ? 'bg-rose-600 hover:bg-rose-700'
                                    : 'bg-emerald-600 hover:bg-emerald-700'
                            }`}
                        >
                            {policy.status === 'ACTIVE' ? 'Pause Automation' : 'Activate Automation'}
                        </button>
                    </div>
                </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Version</div>
                    <div className="mt-3 text-2xl font-bold text-slate-900">v{policy.version}</div>
                    <p className="mt-2 text-sm text-slate-500">Current policy revision used for upcoming runs.</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Relevance Gate</div>
                    <div className="mt-3 text-2xl font-bold text-slate-900">{policy.relevance_min_score}</div>
                    <p className="mt-2 text-sm text-slate-500">Minimum relevance score required before capture continues.</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Intent Gate</div>
                    <div className="mt-3 text-2xl font-bold text-slate-900">{policy.intent_min_score}</div>
                    <p className="mt-2 text-sm text-slate-500">Minimum intent threshold for downstream lead qualification.</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Current Mode</div>
                    <div className="mt-3 text-lg font-bold text-slate-900">{policy.mode}</div>
                    <p className="mt-2 text-sm text-slate-500">{modeLabel(policy.mode)}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Discovery Cap</div>
                        <div className="mt-3 text-2xl font-bold text-slate-900">{policy.max_source_posts_per_run}</div>
                    <p className="mt-2 text-sm text-slate-500">Maximum source posts the current run can inspect before capture stops.</p>
                </div>
            </div>

            {error && <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
            {notice && (
                <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                    {notice}
                </div>
            )}

            <div className="mt-6 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
                <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Decision Gates</div>
                            <h2 className="mt-2 text-xl font-bold text-slate-900">Relevance and intent thresholds</h2>
                            <p className="mt-2 text-sm text-slate-600">
                                These controls determine how strict the brand is before content becomes eligible for capture and lead evaluation.
                            </p>
                        </div>
                    </div>

                    <div className="mt-6 grid gap-5 md:grid-cols-2">
                        <label className="block">
                            <span className="text-sm font-medium text-slate-700">Relevance Min Score (0-100)</span>
                            <input
                                type="number"
                                value={policy.relevance_min_score}
                                onChange={(e) => handleChange('relevance_min_score', numberValue(e.target.value))}
                                className="mt-2 block w-full rounded-2xl border border-slate-200 px-4 py-3 shadow-sm"
                            />
                            <span className="mt-2 block text-xs text-slate-500">Higher values reduce noisy discovery and keep matching tighter.</span>
                        </label>
                        <label className="block">
                            <span className="text-sm font-medium text-slate-700">Intent Min Score (0-100)</span>
                            <input
                                type="number"
                                value={policy.intent_min_score}
                                onChange={(e) => handleChange('intent_min_score', numberValue(e.target.value))}
                                className="mt-2 block w-full rounded-2xl border border-slate-200 px-4 py-3 shadow-sm"
                            />
                            <span className="mt-2 block text-xs text-slate-500">Raise this if you want fewer low-confidence buying signals to pass through.</span>
                        </label>
                    </div>

                    <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <label className="flex items-start gap-3">
                            <input
                                type="checkbox"
                                checked={policy.allow_capture_seen_events}
                                onChange={(e) => handleChange('allow_capture_seen_events', e.target.checked)}
                                className="mt-1 h-4 w-4 rounded border-slate-300"
                            />
                            <span>
                                <span className="block text-sm font-semibold text-slate-900">Keep rejected events in the audit trail</span>
                                <span className="mt-1 block text-sm text-slate-600">Use this when you want visibility into what the system saw, even if the event was filtered out.</span>
                            </span>
                        </label>
                    </div>
                </section>

                <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Operational Limits</div>
                    <h2 className="mt-2 text-xl font-bold text-slate-900">Discovery caps</h2>
                    <p className="mt-2 text-sm text-slate-600">
                        Set how many source posts a run can inspect and how many comments can be collected from each source post. These are the only discovery limits applied in the current workflow.
                    </p>

                    <div className="mt-6 space-y-4">
                        <label className="block">
                            <span className="text-sm font-medium text-slate-700">Max Source Posts / Run</span>
                            <input
                                type="number"
                                value={policy.max_source_posts_per_run}
                                min={1}
                                max={60}
                                onChange={(e) => handleChange('max_source_posts_per_run', clamp(numberValue(e.target.value), 1, 60))}
                                className="mt-2 block w-full rounded-2xl border border-slate-200 px-4 py-3 shadow-sm"
                            />
                            <span className="mt-2 block text-xs text-slate-500">Up to 60 source posts can be scanned in one run. Basic tier will still be capped lower by plan rules.</span>
                        </label>
                        <label className="block">
                            <span className="text-sm font-medium text-slate-700">Max Comments / Source Post</span>
                            <input
                                type="number"
                                value={policy.max_comments_per_source_post}
                                min={1}
                                max={10}
                                onChange={(e) => handleChange('max_comments_per_source_post', clamp(numberValue(e.target.value), 1, 10))}
                                className="mt-2 block w-full rounded-2xl border border-slate-200 px-4 py-3 shadow-sm"
                            />
                            <span className="mt-2 block text-xs text-slate-500">Up to 10 comments can be collected from each discovered source post. Basic tier will still be capped lower by plan rules.</span>
                        </label>
                        <label className="block">
                            <span className="text-sm font-medium text-slate-700">Action Pacing (ms)</span>
                            <input
                                type="number"
                                value={policy.cooldown_ms_between_actions}
                                onChange={(e) => handleChange('cooldown_ms_between_actions', numberValue(e.target.value))}
                                className="mt-2 block w-full rounded-2xl border border-slate-200 px-4 py-3 shadow-sm"
                            />
                        </label>
                    </div>

                    <div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50 p-4">
                        <div className="text-sm font-semibold text-blue-900">Current mode guidance</div>
                        <p className="mt-2 text-sm leading-6 text-blue-800">{modeLabel(policy.mode)}</p>
                    </div>
                </section>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
                <span className="text-sm text-slate-500">Saving creates a new version and preserves policy history.</span>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="inline-flex items-center justify-center rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {saving ? 'Saving Policy...' : 'Save New Version'}
                </button>
            </div>
        </div>
    );
};
