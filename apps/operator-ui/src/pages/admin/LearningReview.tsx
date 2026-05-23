import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
    AlertTriangle,
    Archive,
    Check,
    ClipboardList,
    FileText,
    Loader2,
    PlayCircle,
    RefreshCw,
    ShieldCheck,
    XCircle,
} from 'lucide-react';
import { LearningReviewApi, LearningReviewFilters } from '../../lib/api';

type Notice = {
    type: 'success' | 'error';
    message: string;
};

const SUGGESTION_STATUSES = ['', 'OPEN', 'ACCEPTED', 'REJECTED', 'ARCHIVED'];
const PLAN_STATUSES = ['', 'DRAFT', 'REVIEWED', 'CANCELLED'];
const CANDIDATE_STATUSES = ['', 'PENDING', 'ACCEPTED', 'REJECTED', 'ARCHIVED'];

function formatDate(value: unknown) {
    if (!value) return '-';
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString();
}

function shortText(value: unknown, limit = 220) {
    const text = String(value ?? '').trim();
    if (!text) return '-';
    return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function prettyJson(value: unknown) {
    if (value === undefined || value === null) return '{}';
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function statusClass(status: string) {
    if (['ACCEPTED', 'REVIEWED'].includes(status)) return 'bg-emerald-100 text-emerald-700';
    if (['REJECTED', 'CANCELLED'].includes(status)) return 'bg-rose-100 text-rose-700';
    if (['ARCHIVED'].includes(status)) return 'bg-slate-200 text-slate-700';
    if (['HIGH'].includes(status)) return 'bg-rose-100 text-rose-700';
    if (['MEDIUM'].includes(status)) return 'bg-amber-100 text-amber-700';
    if (['LOW'].includes(status)) return 'bg-teal-100 text-teal-700';
    return 'bg-slate-100 text-slate-700';
}

function Pill({ value }: { value: string }) {
    return <span className={`status-pill ${statusClass(String(value || '').toUpperCase())}`}>{value || '-'}</span>;
}

function JsonBlock({ value }: { value: unknown }) {
    return (
        <pre className="max-h-72 overflow-auto rounded-2xl border border-slate-200 bg-white/80 p-3 text-xs leading-relaxed text-slate-700">
            {prettyJson(value)}
        </pre>
    );
}

function ActionButton({
    children,
    onClick,
    disabled,
    tone = 'neutral',
}: {
    children: ReactNode;
    onClick: () => void;
    disabled?: boolean;
    tone?: 'neutral' | 'success' | 'danger' | 'warning';
}) {
    const toneClass = {
        neutral: 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
        success: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
        danger: 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100',
        warning: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100',
    }[tone];
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${toneClass}`}
        >
            {children}
        </button>
    );
}

function InsightPhraseList({ title, items }: { title: string; items: any[] }) {
    return (
        <div className="rounded-2xl border border-slate-200 bg-white/70 p-3">
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{title}</div>
            <div className="mt-2 space-y-2">
                {(items || []).length === 0 && <div className="text-sm text-slate-400">None detected</div>}
                {(items || []).map((item) => (
                    <div key={`${item.phrase}-${item.count}`} className="flex items-center justify-between gap-3 text-sm">
                        <span className="font-semibold text-slate-800">{item.phrase}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">
                            {item.count}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

export function LearningReviewPage() {
    const [filters, setFilters] = useState<LearningReviewFilters>({ limit: 50 });
    const [dashboard, setDashboard] = useState<any>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [detail, setDetail] = useState<any>(null);
    const [candidates, setCandidates] = useState<any[]>([]);
    const [candidateStatus, setCandidateStatus] = useState('');
    const [loading, setLoading] = useState(false);
    const [detailLoading, setDetailLoading] = useState(false);
    const [busyAction, setBusyAction] = useState('');
    const [notice, setNotice] = useState<Notice | null>(null);
    const [editMiningForm, setEditMiningForm] = useState({
        brand_id: '',
        platform: '',
        min_occurrences: 3,
        dry_run: true,
    });
    const [editMiningLoading, setEditMiningLoading] = useState(false);
    const [editMiningAction, setEditMiningAction] = useState<'preview' | 'persist' | ''>('');
    const [editMiningResult, setEditMiningResult] = useState<any>(null);

    const queue = dashboard?.review_queue || [];
    const summary = dashboard?.summary || {};
    const selectedItem = useMemo(
        () => queue.find((item: any) => item.suggestion?.id === selectedId) || null,
        [queue, selectedId],
    );

    const loadDashboard = useCallback(async () => {
        setLoading(true);
        setNotice(null);
        try {
            const data = await LearningReviewApi.fetchDashboard(filters);
            setDashboard(data.dashboard);
            if (!selectedId && data.dashboard?.review_queue?.[0]?.suggestion?.id) {
                setSelectedId(data.dashboard.review_queue[0].suggestion.id);
            }
        } catch (error: any) {
            setNotice({ type: 'error', message: error.message || 'Failed to load dashboard' });
        } finally {
            setLoading(false);
        }
    }, [filters, selectedId]);

    const loadDetail = useCallback(async (suggestionId: string) => {
        setDetailLoading(true);
        try {
            const data = await LearningReviewApi.fetchDetail(suggestionId);
            setDetail(data.detail);
            const suggestion = data.detail?.suggestion || {};
            const candidateData = await LearningReviewApi.fetchApplyCandidates({
                brand_id: suggestion.brand_id || filters.brand_id,
                platform: suggestion.platform || filters.platform,
                status: candidateStatus,
                limit: 200,
            });
            const planIds = new Set((data.detail?.apply_plans || []).map((plan: any) => plan.id));
            setCandidates((candidateData.candidates || []).filter((candidate: any) => (
                candidate.learning_suggestion_id === suggestionId ||
                planIds.has(candidate.learning_apply_plan_id)
            )));
        } catch (error: any) {
            setNotice({ type: 'error', message: error.message || 'Failed to load detail' });
        } finally {
            setDetailLoading(false);
        }
    }, [candidateStatus, filters.brand_id, filters.platform]);

    useEffect(() => {
        loadDashboard();
    }, [loadDashboard]);

    useEffect(() => {
        setEditMiningForm((current) => ({
            ...current,
            brand_id: current.brand_id || filters.brand_id || '',
            platform: current.platform || filters.platform || '',
        }));
    }, [filters.brand_id, filters.platform]);

    useEffect(() => {
        if (selectedId) {
            loadDetail(selectedId);
        } else {
            setDetail(null);
            setCandidates([]);
        }
    }, [loadDetail, selectedId]);

    const refreshAll = async () => {
        await loadDashboard();
        if (selectedId) await loadDetail(selectedId);
    };

    const runWithPrompt = async (
        actionKey: string,
        promptText: string,
        task: (note: string | null) => Promise<any>,
    ) => {
        const note = window.prompt(promptText);
        if (note === null) return;
        setBusyAction(actionKey);
        setNotice(null);
        try {
            await task(note.trim() || null);
            setNotice({ type: 'success', message: 'Action completed.' });
            await refreshAll();
        } catch (error: any) {
            setNotice({ type: 'error', message: error.message || 'Action failed' });
        } finally {
            setBusyAction('');
        }
    };

    const runWithConfirm = async (actionKey: string, message: string, task: () => Promise<any>) => {
        if (!window.confirm(message)) return;
        setBusyAction(actionKey);
        setNotice(null);
        try {
            await task();
            setNotice({ type: 'success', message: 'Action completed.' });
            await refreshAll();
        } catch (error: any) {
            setNotice({ type: 'error', message: error.message || 'Action failed' });
        } finally {
            setBusyAction('');
        }
    };

    const updateFilter = (key: keyof LearningReviewFilters, value: string) => {
        setSelectedId(null);
        setDetail(null);
        setFilters((current) => ({
            ...current,
            [key]: value,
        }));
    };

    const updateEditMiningForm = (key: keyof typeof editMiningForm, value: string | number | boolean) => {
        setEditMiningForm((current) => ({
            ...current,
            [key]: value,
        }));
    };

    const runEditMining = async (dryRun: boolean) => {
        if (!dryRun && !window.confirm('This will create inactive ApplyCandidate records only. It will not change AI behavior.')) {
            return;
        }
        setEditMiningLoading(true);
        setEditMiningAction(dryRun ? 'preview' : 'persist');
        setNotice(null);
        try {
            const result = await LearningReviewApi.runEditMining({
                brand_id: editMiningForm.brand_id.trim() || undefined,
                platform: editMiningForm.platform.trim() || undefined,
                min_occurrences: Number(editMiningForm.min_occurrences) || 3,
                dry_run: dryRun,
            });
            setEditMiningResult(result);
            setEditMiningForm((current) => ({ ...current, dry_run: dryRun }));
            setNotice({
                type: 'success',
                message: dryRun
                    ? 'Edit mining preview completed.'
                    : `Edit mining persisted ${result.persisted_count || 0} inactive candidate records.`,
            });
            if (!dryRun) {
                await refreshAll();
            }
        } catch (error: any) {
            setNotice({ type: 'error', message: error.message || 'Failed to run edit mining' });
        } finally {
            setEditMiningLoading(false);
            setEditMiningAction('');
        }
    };

    const activePlan = detail?.apply_plans?.find((plan: any) => plan.status === 'DRAFT') ||
        detail?.apply_plans?.[0] ||
        selectedItem?.apply_plan ||
        null;
    const suggestion = detail?.suggestion || selectedItem?.suggestion || null;
    const sourceExamples = detail?.source_feedback_examples || selectedItem?.source_feedback_examples || [];

    return (
        <div className="space-y-6">
            <section className="panel p-6 lg:p-8">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <div className="hero-kicker">Internal Learning Review</div>
                        <h1 className="hero-title mt-3">Feedback learning pipeline review</h1>
                        <p className="hero-copy">
                            Inspect feedback insights, suggestions, apply plans, and inactive candidate records before any future implementation work.
                        </p>
                    </div>
                    <ActionButton onClick={refreshAll} disabled={loading || detailLoading}>
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        Refresh
                    </ActionButton>
                </div>
                <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-800">
                    Candidates are inactive records. Accepting them does not change AI behavior, prompts, QC, strategy, or runtime configuration.
                </div>
            </section>

            {notice && (
                <div className={`rounded-2xl border p-4 text-sm font-semibold ${notice.type === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-rose-200 bg-rose-50 text-rose-700'
                    }`}>
                    {notice.message}
                </div>
            )}

            <section className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
                {[
                    ['Total suggestions', summary.total_suggestions ?? 0],
                    ['Open suggestions', summary.open_suggestions ?? 0],
                    ['Accepted', summary.accepted_suggestions ?? 0],
                    ['Draft plans', summary.draft_apply_plans ?? 0],
                    ['Reviewed plans', summary.reviewed_apply_plans ?? 0],
                    ['High risk', summary.high_risk_items ?? 0],
                ].map(([label, value]) => (
                    <div key={String(label)} className="metric-panel">
                        <div className="text-sm font-semibold text-slate-500">{label}</div>
                        <div className="mt-2 text-3xl font-bold text-slate-900">{value}</div>
                    </div>
                ))}
            </section>

            <section className="panel p-5">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                    <label className="space-y-2 text-sm font-semibold text-slate-600">
                        <span>Brand ID</span>
                        <input
                            className="surface-input"
                            value={filters.brand_id || ''}
                            onChange={(event) => updateFilter('brand_id', event.target.value)}
                            placeholder="Optional"
                        />
                    </label>
                    <label className="space-y-2 text-sm font-semibold text-slate-600">
                        <span>Platform</span>
                        <input
                            className="surface-input"
                            value={filters.platform || ''}
                            onChange={(event) => updateFilter('platform', event.target.value)}
                            placeholder="xiaohongshu"
                        />
                    </label>
                    <label className="space-y-2 text-sm font-semibold text-slate-600">
                        <span>Suggestion status</span>
                        <select
                            className="surface-input"
                            value={filters.suggestion_status || ''}
                            onChange={(event) => updateFilter('suggestion_status', event.target.value)}
                        >
                            {SUGGESTION_STATUSES.map((status) => (
                                <option key={status || 'all'} value={status}>{status || 'All'}</option>
                            ))}
                        </select>
                    </label>
                    <label className="space-y-2 text-sm font-semibold text-slate-600">
                        <span>Plan status</span>
                        <select
                            className="surface-input"
                            value={filters.plan_status || ''}
                            onChange={(event) => updateFilter('plan_status', event.target.value)}
                        >
                            {PLAN_STATUSES.map((status) => (
                                <option key={status || 'all'} value={status}>{status || 'All'}</option>
                            ))}
                        </select>
                    </label>
                    <label className="space-y-2 text-sm font-semibold text-slate-600">
                        <span>Candidate status</span>
                        <select
                            className="surface-input"
                            value={candidateStatus}
                            onChange={(event) => setCandidateStatus(event.target.value)}
                        >
                            {CANDIDATE_STATUSES.map((status) => (
                                <option key={status || 'all'} value={status}>{status || 'All'}</option>
                            ))}
                        </select>
                    </label>
                </div>
            </section>

            <section className="panel p-5">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                    <div>
                        <div className="hero-kicker">Edit Mining</div>
                        <h2 className="mt-2 text-xl font-bold text-slate-900">Mine human edits for inactive candidates</h2>
                        <p className="mt-2 max-w-3xl text-sm font-medium text-slate-600">
                            These candidates are inactive. Persisting them does not change prompts, QC, strategy, or runtime behavior.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <ActionButton
                            disabled={editMiningLoading}
                            onClick={() => runEditMining(true)}
                        >
                            {editMiningLoading && editMiningAction === 'preview' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                            Preview mined candidates
                        </ActionButton>
                        <ActionButton
                            tone="warning"
                            disabled={editMiningLoading}
                            onClick={() => runEditMining(false)}
                        >
                            {editMiningLoading && editMiningAction === 'persist' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                            Persist candidates
                        </ActionButton>
                    </div>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-4">
                    <label className="space-y-2 text-sm font-semibold text-slate-600">
                        <span>Brand ID</span>
                        <input
                            className="surface-input"
                            value={editMiningForm.brand_id}
                            onChange={(event) => updateEditMiningForm('brand_id', event.target.value)}
                            placeholder="Optional"
                        />
                    </label>
                    <label className="space-y-2 text-sm font-semibold text-slate-600">
                        <span>Platform</span>
                        <input
                            className="surface-input"
                            value={editMiningForm.platform}
                            onChange={(event) => updateEditMiningForm('platform', event.target.value)}
                            placeholder="xiaohongshu"
                        />
                    </label>
                    <label className="space-y-2 text-sm font-semibold text-slate-600">
                        <span>Min occurrences</span>
                        <input
                            className="surface-input"
                            type="number"
                            min={1}
                            value={editMiningForm.min_occurrences}
                            onChange={(event) => updateEditMiningForm('min_occurrences', Number(event.target.value))}
                        />
                    </label>
                    <label className="flex min-h-11 items-center gap-3 self-end rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700">
                        <input
                            type="checkbox"
                            checked={editMiningForm.dry_run}
                            onChange={(event) => updateEditMiningForm('dry_run', event.target.checked)}
                        />
                        Dry run by default
                    </label>
                </div>

                {editMiningResult && (
                    <div className="mt-5 space-y-4">
                        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                            {[
                                ['Total feedback', editMiningResult.insights?.total_feedback ?? 0],
                                ['Analyzed', editMiningResult.insights?.analyzed_feedback ?? 0],
                                ['Shortened', editMiningResult.insights?.shortened_reply_count ?? 0],
                                ['Direct answers', editMiningResult.insights?.direct_answer_added_count ?? 0],
                                ['Drafts', editMiningResult.candidate_drafts?.length ?? 0],
                                ['Persisted', editMiningResult.persisted_count ?? 0],
                            ].map(([label, value]) => (
                                <div key={String(label)} className="rounded-2xl border border-slate-200 bg-white/70 p-4">
                                    <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{label}</div>
                                    <div className="mt-2 text-2xl font-bold text-slate-900">{value}</div>
                                </div>
                            ))}
                        </div>

                        <div className="grid gap-3 lg:grid-cols-3">
                            <InsightPhraseList title="Removed AI phrases" items={editMiningResult.insights?.removed_ai_phrases || []} />
                            <InsightPhraseList title="Removed CTA phrases" items={editMiningResult.insights?.removed_cta_phrases || []} />
                            <InsightPhraseList title="Removed questions" items={editMiningResult.insights?.removed_unnecessary_questions || []} />
                        </div>

                        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-800">
                            Skipped duplicate pending candidates: {editMiningResult.skipped_duplicate_count || 0}. Persisted candidates remain inactive until a future controlled implementation workflow.
                        </div>

                        <div className="grid gap-3 xl:grid-cols-2">
                            {(editMiningResult.candidate_drafts || []).map((candidate: any, index: number) => (
                                <div key={`${candidate.title}-${index}`} className="rounded-2xl border border-slate-200 bg-white/80 p-4">
                                    <div className="flex flex-wrap gap-2">
                                        <Pill value={candidate.candidate_type} />
                                        <Pill value={candidate.risk_level || 'low'} />
                                        <Pill value={`${(candidate.source_feedback_ids || []).length} sources`} />
                                    </div>
                                    <h3 className="mt-3 text-sm font-bold text-slate-900">{candidate.title}</h3>
                                    <p className="mt-1 text-sm text-slate-600">{candidate.description}</p>
                                    <div className="mt-3">
                                        <JsonBlock value={candidate.candidate_payload} />
                                    </div>
                                </div>
                            ))}
                            {(editMiningResult.candidate_drafts || []).length === 0 && (
                                <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-500">
                                    No candidate drafts met the current minimum occurrence threshold.
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </section>

            <section className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)]">
                <div className="table-shell overflow-x-auto">
                    <table className="min-w-full">
                        <thead className="table-head border-b border-slate-200">
                            <tr>
                                <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Created</th>
                                <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Risk</th>
                                <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Suggestion</th>
                                <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Plan</th>
                                <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Next</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && (
                                <tr>
                                    <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                                        Loading learning review queue...
                                    </td>
                                </tr>
                            )}
                            {!loading && queue.map((item: any) => (
                                <tr
                                    key={item.suggestion.id}
                                    className={`table-row cursor-pointer border-b border-slate-100 ${selectedId === item.suggestion.id ? 'bg-teal-50/70' : ''}`}
                                    onClick={() => setSelectedId(item.suggestion.id)}
                                >
                                    <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-500">
                                        {formatDate(item.created_at)}
                                    </td>
                                    <td className="px-4 py-4">
                                        <Pill value={String(item.risk_level || item.suggestion.severity || 'medium').toUpperCase()} />
                                    </td>
                                    <td className="min-w-[280px] px-4 py-4">
                                        <div className="flex flex-wrap gap-2">
                                            <Pill value={item.suggestion.suggestion_type} />
                                            <Pill value={item.suggestion.status} />
                                        </div>
                                        <div className="mt-2 text-sm font-semibold text-slate-900">{item.suggestion.title || item.suggestion.message}</div>
                                        <div className="mt-1 text-sm text-slate-500">{shortText(item.suggestion.message, 160)}</div>
                                    </td>
                                    <td className="px-4 py-4">
                                        <Pill value={item.apply_plan?.status || 'NO_PLAN'} />
                                    </td>
                                    <td className="min-w-[220px] px-4 py-4 text-sm text-slate-700">
                                        <div className="font-semibold">{item.next_action?.type || 'NO_ACTION'}</div>
                                        <div className="mt-1 text-slate-500">{shortText(item.next_action?.message, 120)}</div>
                                    </td>
                                </tr>
                            ))}
                            {!loading && queue.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-4 py-12 text-center text-slate-500">
                                        No learning suggestions match the current filters.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <aside className="space-y-4">
                    <section className="panel-strong p-5">
                        {!suggestion && (
                            <div className="py-10 text-center text-slate-500">Select a suggestion to inspect the review chain.</div>
                        )}
                        {suggestion && (
                            <div className="space-y-5">
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <div className="hero-kicker">Selected suggestion</div>
                                        <h2 className="mt-2 text-xl font-bold text-slate-900">{suggestion.title || suggestion.suggestion_type}</h2>
                                        <p className="mt-2 text-sm text-slate-600">{suggestion.message}</p>
                                    </div>
                                    {detailLoading && <Loader2 className="h-5 w-5 animate-spin text-slate-400" />}
                                </div>

                                <div className="flex flex-wrap gap-2">
                                    <Pill value={suggestion.suggestion_type} />
                                    <Pill value={suggestion.status} />
                                    <Pill value={suggestion.severity || 'medium'} />
                                </div>

                                <div className="flex flex-wrap gap-2">
                                    {suggestion.status === 'OPEN' && (
                                        <>
                                            <ActionButton
                                                tone="success"
                                                disabled={!!busyAction}
                                                onClick={() => runWithPrompt(
                                                    `suggestion-${suggestion.id}-accept`,
                                                    'Accept this suggestion? Optional review note:',
                                                    (note) => LearningReviewApi.updateSuggestionStatus(suggestion.id, 'ACCEPTED', note),
                                                )}
                                            >
                                                <Check className="h-4 w-4" />
                                                Accept
                                            </ActionButton>
                                            <ActionButton
                                                tone="danger"
                                                disabled={!!busyAction}
                                                onClick={() => runWithPrompt(
                                                    `suggestion-${suggestion.id}-reject`,
                                                    'Reject this suggestion? Optional review note:',
                                                    (note) => LearningReviewApi.updateSuggestionStatus(suggestion.id, 'REJECTED', note),
                                                )}
                                            >
                                                <XCircle className="h-4 w-4" />
                                                Reject
                                            </ActionButton>
                                            <ActionButton
                                                disabled={!!busyAction}
                                                onClick={() => runWithPrompt(
                                                    `suggestion-${suggestion.id}-archive`,
                                                    'Archive this suggestion? Optional review note:',
                                                    (note) => LearningReviewApi.updateSuggestionStatus(suggestion.id, 'ARCHIVED', note),
                                                )}
                                            >
                                                <Archive className="h-4 w-4" />
                                                Archive
                                            </ActionButton>
                                        </>
                                    )}

                                    {suggestion.status === 'ACCEPTED' && !activePlan && (
                                        <ActionButton
                                            tone="warning"
                                            disabled={!!busyAction}
                                            onClick={() => runWithConfirm(
                                                `suggestion-${suggestion.id}-plan`,
                                                'Generate an apply plan preview for this accepted suggestion?',
                                                () => LearningReviewApi.generateApplyPlan(suggestion.id),
                                            )}
                                        >
                                            <FileText className="h-4 w-4" />
                                            Generate apply plan
                                        </ActionButton>
                                    )}
                                </div>

                                <div className="grid gap-4 lg:grid-cols-2">
                                    <div>
                                        <div className="mb-2 text-sm font-bold text-slate-700">Evidence</div>
                                        <JsonBlock value={suggestion.evidence} />
                                    </div>
                                    <div>
                                        <div className="mb-2 text-sm font-bold text-slate-700">Proposed action</div>
                                        <JsonBlock value={suggestion.proposed_action} />
                                    </div>
                                </div>
                            </div>
                        )}
                    </section>

                    {activePlan && (
                        <section className="panel-strong p-5">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <div className="hero-kicker">Apply plan</div>
                                    <h3 className="mt-2 text-lg font-bold text-slate-900">{activePlan.summary}</h3>
                                    <p className="mt-2 text-sm text-slate-600">{activePlan.rationale}</p>
                                </div>
                                <Pill value={activePlan.status} />
                            </div>
                            <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
                                <div>
                                    <span className="font-semibold text-slate-500">Target area</span>
                                    <div className="mt-1 font-bold text-slate-900">{activePlan.target_area}</div>
                                </div>
                                <div>
                                    <span className="font-semibold text-slate-500">Change type</span>
                                    <div className="mt-1 font-bold text-slate-900">{activePlan.proposed_change_type}</div>
                                </div>
                            </div>
                            <div className="mt-4 flex flex-wrap gap-2">
                                {activePlan.status === 'DRAFT' && (
                                    <>
                                        <ActionButton
                                            tone="success"
                                            disabled={!!busyAction}
                                            onClick={() => runWithPrompt(
                                                `plan-${activePlan.id}-review`,
                                                'Mark this apply plan as reviewed? Optional review note:',
                                                (note) => LearningReviewApi.updateApplyPlanStatus(activePlan.id, 'REVIEWED', note),
                                            )}
                                        >
                                            <ShieldCheck className="h-4 w-4" />
                                            Mark reviewed
                                        </ActionButton>
                                        <ActionButton
                                            tone="danger"
                                            disabled={!!busyAction}
                                            onClick={() => runWithPrompt(
                                                `plan-${activePlan.id}-cancel`,
                                                'Cancel this apply plan? Optional review note:',
                                                (note) => LearningReviewApi.updateApplyPlanStatus(activePlan.id, 'CANCELLED', note),
                                            )}
                                        >
                                            <XCircle className="h-4 w-4" />
                                            Cancel
                                        </ActionButton>
                                    </>
                                )}
                                {activePlan.status === 'REVIEWED' && (
                                    <ActionButton
                                        tone="warning"
                                        disabled={!!busyAction}
                                        onClick={() => runWithConfirm(
                                            `plan-${activePlan.id}-candidates`,
                                            'Generate inactive apply candidates from this reviewed plan?',
                                            () => LearningReviewApi.generateApplyCandidates(activePlan.id),
                                        )}
                                    >
                                        <PlayCircle className="h-4 w-4" />
                                        Generate candidates
                                    </ActionButton>
                                )}
                            </div>
                            <div className="mt-4">
                                <div className="mb-2 text-sm font-bold text-slate-700">Suggested tests</div>
                                <JsonBlock value={activePlan.suggested_tests} />
                            </div>
                        </section>
                    )}

                    <section className="panel-strong p-5">
                        <div className="flex items-center gap-2">
                            <ClipboardList className="h-5 w-5 text-teal-700" />
                            <h3 className="text-lg font-bold text-slate-900">Source feedback examples</h3>
                        </div>
                        <div className="mt-4 space-y-3">
                            {sourceExamples.map((example: any) => (
                                <div key={example.id} className="rounded-2xl border border-slate-200 bg-white/80 p-4">
                                    <div className="mb-2 flex flex-wrap gap-2">
                                        <Pill value={example.feedback_type} />
                                        {(example.selected_reasons || []).map((reason: string) => (
                                            <Pill key={reason} value={reason} />
                                        ))}
                                    </div>
                                    <div>
                                        <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Generated reply</div>
                                        <div className="mt-1 text-sm font-semibold text-slate-900">{shortText(example.original_draft_text, 500)}</div>
                                    </div>
                                    {example.human_edited_text && (
                                        <div className="mt-3">
                                            <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Human edit</div>
                                            <div className="mt-1 text-sm text-slate-600">{shortText(example.human_edited_text, 500)}</div>
                                        </div>
                                    )}
                                    {example.final_sent_text && (
                                        <div className="mt-3">
                                            <div className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Final sent reply</div>
                                            <div className="mt-1 text-sm text-slate-600">{shortText(example.final_sent_text, 500)}</div>
                                        </div>
                                    )}
                                    <button
                                        type="button"
                                        className="mt-3 text-sm font-semibold text-teal-700 hover:text-teal-900"
                                        onClick={() => navigator.clipboard?.writeText(example.original_draft_text || '')}
                                    >
                                        Copy original draft
                                    </button>
                                </div>
                            ))}
                            {sourceExamples.length === 0 && (
                                <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-500">
                                    No source feedback examples are linked to this suggestion.
                                </div>
                            )}
                        </div>
                    </section>

                    <section className="panel-strong p-5">
                        <div className="flex items-start gap-3">
                            <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
                            <div>
                                <h3 className="text-lg font-bold text-slate-900">Apply candidates</h3>
                                <p className="mt-1 text-sm font-medium text-amber-800">
                                    Candidates are inactive records. Accepting them does not change AI behavior.
                                </p>
                            </div>
                        </div>
                        <div className="mt-4 space-y-3">
                            {candidates.map((candidate) => (
                                <div key={candidate.id} className="rounded-2xl border border-slate-200 bg-white/80 p-4">
                                    <div className="flex flex-wrap gap-2">
                                        <Pill value={candidate.candidate_type} />
                                        <Pill value={candidate.status} />
                                        <Pill value={candidate.risk_level || 'medium'} />
                                    </div>
                                    <div className="mt-3 text-sm font-bold text-slate-900">{candidate.title}</div>
                                    <p className="mt-1 text-sm text-slate-600">{candidate.description}</p>
                                    <div className="mt-3">
                                        <JsonBlock value={candidate.candidate_payload} />
                                    </div>
                                    {candidate.status === 'PENDING' && (
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            <ActionButton
                                                tone="success"
                                                disabled={!!busyAction}
                                                onClick={() => runWithPrompt(
                                                    `candidate-${candidate.id}-accept`,
                                                    'Accept this inactive candidate? This does not change AI behavior. Optional review note:',
                                                    (note) => LearningReviewApi.updateApplyCandidateStatus(candidate.id, 'ACCEPTED', note),
                                                )}
                                            >
                                                <Check className="h-4 w-4" />
                                                Accept
                                            </ActionButton>
                                            <ActionButton
                                                tone="danger"
                                                disabled={!!busyAction}
                                                onClick={() => runWithPrompt(
                                                    `candidate-${candidate.id}-reject`,
                                                    'Reject this inactive candidate? Optional review note:',
                                                    (note) => LearningReviewApi.updateApplyCandidateStatus(candidate.id, 'REJECTED', note),
                                                )}
                                            >
                                                <XCircle className="h-4 w-4" />
                                                Reject
                                            </ActionButton>
                                            <ActionButton
                                                disabled={!!busyAction}
                                                onClick={() => runWithPrompt(
                                                    `candidate-${candidate.id}-archive`,
                                                    'Archive this inactive candidate? Optional review note:',
                                                    (note) => LearningReviewApi.updateApplyCandidateStatus(candidate.id, 'ARCHIVED', note),
                                                )}
                                            >
                                                <Archive className="h-4 w-4" />
                                                Archive
                                            </ActionButton>
                                        </div>
                                    )}
                                </div>
                            ))}
                            {candidates.length === 0 && (
                                <div className="rounded-2xl border border-slate-200 bg-white/70 p-4 text-sm text-slate-500">
                                    No apply candidates are linked to this selected review item.
                                </div>
                            )}
                        </div>
                    </section>
                </aside>
            </section>
        </div>
    );
}
