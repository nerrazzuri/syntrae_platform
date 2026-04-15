import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Client } from '../lib/api';
import { Target, Sparkles, ShieldCheck, ExternalLink, ArrowUpRight } from 'lucide-react';
import { PaginationControls } from '../components/PaginationControls';

type LeadStatus = 'NEW' | 'CONTACTED' | 'QUALIFIED' | 'CONVERTED' | 'LOST';
type OutcomeSource = 'MANUAL' | 'INTEGRATED' | 'ESTIMATED';

interface LeadRecord {
    id: string;
    platform: string;
    video_id: string;
    comment_id: string;
    user_handle?: string | null;
    user_profile_url?: string | null;
    intent: string;
    buyer_stage: string;
    confidence: number;
    recommended_action: string;
    lead_status: LeadStatus;
    urgency_score: number;
    source_event_id: string;
    created_at: string;
    followed_up_at?: string | null;
    converted_at?: string | null;
    deal_value?: number | null;
    outcome_reason?: string | null;
    outcome_source: OutcomeSource;
    original_comment?: string | null;
    thread_reference?: {
        thread_url?: string | null;
    };
    matched_catalog_item_name?: string | null;
    catalog_match_score?: number | null;
    catalog_match_reasons?: string[] | null;
    matched_catalog_item?: {
        id: string;
        name: string;
        category?: string | null;
        description?: string | null;
        price_label?: string | null;
        cta_url?: string | null;
        cta_label?: string | null;
    } | null;
    has_draft?: boolean;
    latest_draft?: {
        id: string;
        status: string;
        created_at: string;
        sent_at?: string | null;
    } | null;
}

interface UsageData {
    features: Record<string, boolean>;
}

interface LeadListResponse {
    items: LeadRecord[];
    total: number;
    summary: {
        high_intent_leads: number;
        estimated_revenue: number;
    };
}

function formatDate(dateStr?: string | null) {
    if (!dateStr) return 'Not set';
    const d = new Date(dateStr);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

function formatDateTimeInput(dateStr?: string | null) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const offset = d.getTimezoneOffset();
    const local = new Date(d.getTime() - offset * 60 * 1000);
    return local.toISOString().slice(0, 16);
}

function currency(value?: number | null) {
    return new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR', maximumFractionDigits: 0 }).format(value || 0);
}

export function Leads() {
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [leads, setLeads] = useState<LeadRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [total, setTotal] = useState(0);
    const [selectedLead, setSelectedLead] = useState<LeadRecord | null>(null);
    const [draftGenerationLoadingId, setDraftGenerationLoadingId] = useState<string | null>(null);
    const [savingOutcome, setSavingOutcome] = useState(false);
    const [leadError, setLeadError] = useState<string | null>(null);
    const [leadNotice, setLeadNotice] = useState<string | null>(null);
    const [usage, setUsage] = useState<UsageData | null>(null);
    const [summary, setSummary] = useState({ high_intent_leads: 0, estimated_revenue: 0 });

    const loadData = async () => {
        try {
            setLoading(true);
            const offset = (page - 1) * pageSize;
            const [leadData, usageData] = await Promise.all([
                Client.get(`/leads?limit=${pageSize}&offset=${offset}`) as Promise<LeadListResponse>,
                Client.get('/analytics/usage'),
            ]);
            setLeads(leadData.items || []);
            setTotal(leadData.total || 0);
            setSummary(leadData.summary || { high_intent_leads: 0, estimated_revenue: 0 });
            setUsage(usageData);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, [page, pageSize]);

    const commentPreview = (lead: LeadRecord) => {
        if (lead.original_comment) return lead.original_comment;
        if (lead.comment_id) return `Comment ID: ${lead.comment_id}`;
        return 'No comment available';
    };

    const buyerStageBadge = (stage: string) => {
        const colors: Record<string, string> = {
            AWARENESS: 'bg-sky-100 text-sky-700',
            EVALUATING: 'bg-amber-100 text-amber-700',
            READY: 'bg-emerald-100 text-emerald-700',
        };
        return colors[stage] || 'bg-slate-100 text-slate-700';
    };

    const lifecycleBadge = (status: LeadStatus) => {
        const colors: Record<LeadStatus, string> = {
            NEW: 'bg-slate-100 text-slate-700',
            CONTACTED: 'bg-indigo-100 text-indigo-700',
            QUALIFIED: 'bg-teal-100 text-teal-700',
            CONVERTED: 'bg-emerald-100 text-emerald-700',
            LOST: 'bg-rose-100 text-rose-700',
        };
        return colors[status];
    };

    const draftBadge = (status?: string | null) => {
        const colors: Record<string, string> = {
            DRAFT: 'bg-violet-100 text-violet-700',
            APPROVED: 'bg-sky-100 text-sky-700',
            EDITED: 'bg-amber-100 text-amber-700',
            SENT: 'bg-emerald-100 text-emerald-700',
            REJECTED: 'bg-rose-100 text-rose-700',
        };
        return colors[status || ''] || 'bg-slate-100 text-slate-700';
    };

    const generateReply = async (leadId: string) => {
        setDraftGenerationLoadingId(leadId);
        setLeadError(null);
        try {
            const existingLead = leads.find((lead) => lead.id === leadId) || null;
            if (existingLead?.latest_draft?.id) {
                const statusFilter = existingLead.latest_draft.status === 'SENT'
                    ? 'SENT'
                    : existingLead.latest_draft.status === 'REJECTED'
                        ? 'REJECTED'
                        : existingLead.latest_draft.status === 'APPROVED'
                            ? 'APPROVED'
                            : 'PENDING';
                window.location.href = `/replies?status=${encodeURIComponent(statusFilter)}&draft=${encodeURIComponent(existingLead.latest_draft.id)}`;
                return;
            }

            const draft = await Client.post(`/leads/${leadId}/draft`, {}) as { id?: string; status?: string };
            const statusFilter = draft?.status === 'APPROVED' ? 'APPROVED' : 'PENDING';
            if (draft?.id) {
                window.location.href = `/replies?status=${encodeURIComponent(statusFilter)}&draft=${encodeURIComponent(draft.id)}`;
                return;
            }
            window.location.href = '/replies';
        } catch (e: any) {
            setLeadError(e.message || 'Failed to generate reply');
        } finally {
            setDraftGenerationLoadingId(null);
        }
    };

    const refreshSelectedLead = (leadId: string, updatedLead: LeadRecord) => {
        setLeads((current) => current.map((lead) => (lead.id === leadId ? updatedLead : lead)));
        setSelectedLead(updatedLead);
    };

    const updateLeadOutcome = async (updates: Partial<LeadRecord>) => {
        if (!selectedLead) return;
        setSavingOutcome(true);
        setLeadError(null);
        setLeadNotice(null);
        try {
            const updated = await Client.patch(`/leads/${selectedLead.id}/outcome`, updates);
            refreshSelectedLead(selectedLead.id, updated);
            setLeadNotice('Lead outcome updated.');
        } catch (e: any) {
            setLeadError(e.message || 'Failed to update lead outcome');
        } finally {
            setSavingOutcome(false);
        }
    };

    const exportLocked = usage ? !usage.features.exportEnabled : false;

    return (
        <div className="space-y-6">
            <section className="panel p-6 lg:p-8">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <div className="hero-kicker">Lead Opportunities</div>
                        <h1 className="hero-title mt-3">Move leads from captured comments to commercial outcomes.</h1>
                        <p className="hero-copy">
                            Treat each lead as a pipeline record: review the original comment, decide whether it was contacted,
                            and record conversion value when it turns into revenue.
                        </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                        <div className="metric-panel min-w-[180px]">
                            <div className="text-sm font-semibold text-slate-500">Total Leads</div>
                            <div className="mt-2 text-3xl font-bold">{total}</div>
                        </div>
                        <div className="metric-panel min-w-[180px]">
                            <div className="text-sm font-semibold text-slate-500">High-Intent</div>
                            <div className="mt-2 text-3xl font-bold">{summary.high_intent_leads}</div>
                        </div>
                        <div className="metric-panel min-w-[180px]">
                            <div className="text-sm font-semibold text-slate-500">Reported Value</div>
                            <div className="mt-2 text-3xl font-bold">{currency(summary.estimated_revenue)}</div>
                        </div>
                    </div>
                </div>
            </section>

            {exportLocked && summary.high_intent_leads > 0 && (
                <section className="panel border border-amber-200 bg-amber-50 p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <div className="text-sm font-semibold text-amber-900">Export is locked on the current plan</div>
                            <p className="mt-2 text-sm leading-6 text-amber-800">
                                You already have {summary.high_intent_leads} high-intent leads in the filtered result set. Upgrade to Growth to export qualified leads and work them outside the console.
                            </p>
                        </div>
                        <Link to="/billing" className="inline-flex items-center gap-2 rounded-full border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900">
                            View upgrade options
                            <ArrowUpRight className="h-4 w-4" />
                        </Link>
                    </div>
                </section>
            )}

            <section className="grid gap-4 md:grid-cols-3">
                <div className="panel flex items-center gap-3 p-5">
                    <Target className="h-5 w-5 text-teal-700" />
                    <div className="text-sm text-slate-600">The original comment stays primary. IDs are only supporting metadata.</div>
                </div>
                <div className="panel flex items-center gap-3 p-5">
                    <Sparkles className="h-5 w-5 text-amber-600" />
                    <div className="text-sm text-slate-600">Lead status should reflect actual operator follow-up, not just model classification.</div>
                </div>
                <div className="panel flex items-center gap-3 p-5">
                    <ShieldCheck className="h-5 w-5 text-emerald-700" />
                    <div className="text-sm text-slate-600">Deal value is manual first, so revenue reporting stays honest even without full CRM sync.</div>
                </div>
            </section>

            <section className="table-shell overflow-x-auto">
                {loading ? (
                    <div className="p-8 text-slate-500">Loading leads...</div>
                ) : leads.length === 0 ? (
                    <div className="p-10 text-center text-slate-400">Leads will appear here once discovery captures buyer intent signals.</div>
                ) : (
                    <>
                        <table className="min-w-full">
                            <thead className="table-head border-b border-slate-200">
                                <tr>
                                    <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Platform</th>
                                    <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Original Comment</th>
                                    <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Stage</th>
                                    <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Lifecycle</th>
                                    <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Confidence</th>
                                    <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Deal Value</th>
                                    <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Created</th>
                                    <th className="px-4 py-4"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {leads.map(lead => (
                                    <tr
                                        key={lead.id}
                                        className="table-row cursor-pointer border-b border-slate-100"
                                        onClick={() => setSelectedLead(lead)}
                                    >
                                    <td className="px-4 py-4 text-sm font-semibold uppercase text-slate-600">{lead.platform}</td>
                                    <td className="px-4 py-4 max-w-md text-sm text-slate-800">
                                        <div className="line-clamp-2" title={commentPreview(lead)}>
                                            {commentPreview(lead)}
                                        </div>
                                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                            {lead.user_handle && <span>@{lead.user_handle}</span>}
                                            <span>{lead.intent || 'N/A'}</span>
                                            {lead.latest_draft && (
                                                <span className={`rounded-full px-2 py-0.5 font-semibold ${draftBadge(lead.latest_draft.status)}`}>
                                                    Reply {lead.latest_draft.status}
                                                </span>
                                            )}
                                            {(lead.matched_catalog_item?.name || lead.matched_catalog_item_name) && (
                                                <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                                                    {lead.matched_catalog_item?.name || lead.matched_catalog_item_name}
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-4 py-4 text-sm">
                                        <span className={`status-pill ${buyerStageBadge(lead.buyer_stage)}`}>
                                            {lead.buyer_stage}
                                        </span>
                                    </td>
                                    <td className="px-4 py-4 text-sm">
                                        <span className={`status-pill ${lifecycleBadge(lead.lead_status)}`}>
                                            {lead.lead_status}
                                        </span>
                                    </td>
                                    <td className="px-4 py-4 text-sm">
                                        <span className={`status-pill ${lead.confidence > 0.7 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                            {(lead.confidence * 100).toFixed(0)}%
                                        </span>
                                    </td>
                                    <td className="px-4 py-4 text-sm whitespace-nowrap text-slate-700">{lead.deal_value != null ? currency(lead.deal_value) : 'Not set'}</td>
                                    <td className="px-4 py-4 text-sm whitespace-nowrap text-slate-500">{formatDate(lead.created_at)}</td>
                                    <td className="px-4 py-4 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            {lead.thread_reference?.thread_url && (
                                                <a
                                                    href={lead.thread_reference.thread_url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                                                >
                                                    <ExternalLink className="h-3.5 w-3.5" />
                                                    Open thread
                                                </a>
                                            )}
                                            <button className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-teal-700 transition hover:bg-teal-50">
                                                View
                                            </button>
                                        </div>
                                    </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <PaginationControls
                            total={total}
                            page={page}
                            pageSize={pageSize}
                            onPageChange={setPage}
                            onPageSizeChange={(size) => {
                                setPageSize(size);
                                setPage(1);
                            }}
                            label="leads"
                        />
                    </>
                )}
            </section>

            {selectedLead && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" onClick={() => setSelectedLead(null)}>
                    <div className="panel-strong max-h-[85vh] w-full max-w-4xl overflow-auto" onClick={(e) => e.stopPropagation()}>
                        <div className="border-b border-slate-200 p-6">
                            <div className="hero-kicker">Lead Detail</div>
                            <h3 className="mt-2 text-xl font-bold">Buyer-signal and outcome review</h3>
                        </div>
                        <div className="space-y-5 p-6">
                            {leadError && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{leadError}</div>}
                            {leadNotice && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{leadNotice}</div>}

                            <div className="grid gap-4 md:grid-cols-3">
                                <DetailField label="Buyer Stage" value={<span className={`status-pill ${buyerStageBadge(selectedLead.buyer_stage)}`}>{selectedLead.buyer_stage}</span>} />
                                <DetailField label="Lifecycle Status" value={<span className={`status-pill ${lifecycleBadge(selectedLead.lead_status)}`}>{selectedLead.lead_status}</span>} />
                                <DetailField label="Confidence" value={`${(selectedLead.confidence * 100).toFixed(1)}%`} />
                            </div>

                            {selectedLead.latest_draft && (
                                <DetailField
                                    label="Reply Draft"
                                    value={
                                        <div className="flex flex-wrap items-center gap-3 text-sm">
                                            <span className={`status-pill ${draftBadge(selectedLead.latest_draft.status)}`}>
                                                {selectedLead.latest_draft.status}
                                            </span>
                                            <span className="text-slate-500">Created {formatDate(selectedLead.latest_draft.created_at)}</span>
                                            <Link to="/replies" className="font-semibold text-teal-700">
                                                Open Pending Replies
                                            </Link>
                                        </div>
                                    }
                                />
                            )}

                            <DetailField label="Original Comment" value={<div className="whitespace-pre-wrap text-sm leading-7">{commentPreview(selectedLead)}</div>} />
                            {selectedLead.thread_reference?.thread_url && (
                                <DetailField
                                    label="Original Thread"
                                    value={
                                        <a href={selectedLead.thread_reference.thread_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700">
                                            <ExternalLink className="h-4 w-4" />
                                            Open original post or thread
                                        </a>
                                    }
                                />
                            )}
                            {(selectedLead.matched_catalog_item?.name || selectedLead.matched_catalog_item_name) && (
                                <DetailField
                                    label="Matched Product"
                                    value={
                                        <div className="space-y-2 text-sm leading-6">
                                            <div className="font-bold text-slate-900">{selectedLead.matched_catalog_item?.name || selectedLead.matched_catalog_item_name}</div>
                                            {selectedLead.matched_catalog_item?.category && <div>Category: {selectedLead.matched_catalog_item.category}</div>}
                                            {selectedLead.matched_catalog_item?.price_label && <div>Price: {selectedLead.matched_catalog_item.price_label}</div>}
                                            {selectedLead.catalog_match_score != null && <div>Match score: {(selectedLead.catalog_match_score * 100).toFixed(0)}%</div>}
                                            {selectedLead.catalog_match_reasons?.length ? <div>Why: {selectedLead.catalog_match_reasons.join('; ')}</div> : null}
                                            {selectedLead.matched_catalog_item?.cta_url && (
                                                <a href={selectedLead.matched_catalog_item.cta_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 font-semibold text-teal-700">
                                                    <ExternalLink className="h-4 w-4" />
                                                    Open product CTA
                                                </a>
                                            )}
                                        </div>
                                    }
                                />
                            )}

                            <div className="grid gap-4 md:grid-cols-2">
                                <label className="panel p-4">
                                    <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Lead Status</div>
                                    <select
                                        className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2.5"
                                        value={selectedLead.lead_status}
                                        onChange={(e) => setSelectedLead({ ...selectedLead, lead_status: e.target.value as LeadStatus })}
                                    >
                                        <option value="NEW">New</option>
                                        <option value="CONTACTED">Contacted</option>
                                        <option value="QUALIFIED">Qualified</option>
                                        <option value="CONVERTED">Converted</option>
                                        <option value="LOST">Lost</option>
                                    </select>
                                </label>
                                <label className="panel p-4">
                                    <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Outcome Source</div>
                                    <select
                                        className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2.5"
                                        value={selectedLead.outcome_source || 'MANUAL'}
                                        onChange={(e) => setSelectedLead({ ...selectedLead, outcome_source: e.target.value as OutcomeSource })}
                                    >
                                        <option value="MANUAL">Manual</option>
                                        <option value="INTEGRATED">Integrated</option>
                                        <option value="ESTIMATED">Estimated</option>
                                    </select>
                                </label>
                                <label className="panel p-4">
                                    <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Followed Up At</div>
                                    <input
                                        type="datetime-local"
                                        className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2.5"
                                        value={formatDateTimeInput(selectedLead.followed_up_at)}
                                        onChange={(e) => setSelectedLead({ ...selectedLead, followed_up_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
                                    />
                                </label>
                                <label className="panel p-4">
                                    <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Converted At</div>
                                    <input
                                        type="datetime-local"
                                        className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2.5"
                                        value={formatDateTimeInput(selectedLead.converted_at)}
                                        onChange={(e) => setSelectedLead({ ...selectedLead, converted_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
                                    />
                                </label>
                                <label className="panel p-4">
                                    <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Deal Value (MYR)</div>
                                    <input
                                        type="number"
                                        min={0}
                                        className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2.5"
                                        value={selectedLead.deal_value ?? ''}
                                        onChange={(e) => setSelectedLead({ ...selectedLead, deal_value: e.target.value ? Number(e.target.value) : null })}
                                    />
                                </label>
                                <label className="panel p-4 md:col-span-2">
                                    <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Outcome Note</div>
                                    <textarea
                                        className="mt-3 min-h-[96px] w-full rounded-xl border border-slate-200 px-3 py-2.5"
                                        value={selectedLead.outcome_reason || ''}
                                        onChange={(e) => setSelectedLead({ ...selectedLead, outcome_reason: e.target.value })}
                                        placeholder="Reason for outcome, conversion details, or context for the next operator."
                                    />
                                </label>
                            </div>

                            <div className="grid gap-4 md:grid-cols-2">
                                <DetailField label="Created At" value={formatDate(selectedLead.created_at)} />
                                <DetailField label="Current Deal Value" value={selectedLead.deal_value != null ? currency(selectedLead.deal_value) : 'Not set'} />
                            </div>

                            <div className="flex flex-wrap gap-3">
                                <button
                                    onClick={() => updateLeadOutcome({
                                        lead_status: selectedLead.lead_status,
                                        followed_up_at: selectedLead.followed_up_at,
                                        converted_at: selectedLead.converted_at,
                                        deal_value: selectedLead.deal_value,
                                        outcome_reason: selectedLead.outcome_reason,
                                        outcome_source: selectedLead.outcome_source,
                                    })}
                                    disabled={savingOutcome}
                                    className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white"
                                >
                                    {savingOutcome ? 'Saving...' : 'Save Outcome'}
                                </button>
                                <button
                                    onClick={() => generateReply(selectedLead.id)}
                                    disabled={draftGenerationLoadingId === selectedLead.id}
                                    className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-teal-700 transition hover:bg-teal-50"
                                >
                                    {draftGenerationLoadingId === selectedLead.id
                                        ? 'Generating...'
                                        : selectedLead.latest_draft
                                            ? 'Open Reply'
                                            : 'Generate Reply'}
                                </button>
                            </div>
                        </div>
                        <div className="border-t border-slate-200 p-6 text-right">
                            <button onClick={() => setSelectedLead(null)} className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function DetailField({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="panel p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">{label}</div>
            <div className="mt-3 text-slate-800">{value}</div>
        </div>
    );
}
