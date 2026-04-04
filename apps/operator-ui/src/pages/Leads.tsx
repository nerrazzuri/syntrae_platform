import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Client } from '../lib/api';
import { Target, Sparkles, ShieldCheck } from 'lucide-react';

export function Leads() {
    const [leads, setLeads] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [total, setTotal] = useState(0);
    const [selectedLead, setSelectedLead] = useState<any | null>(null);
    const [draftGenerationLoadingId, setDraftGenerationLoadingId] = useState<string | null>(null);

    const loadData = async () => {
        try {
            setLoading(true);
            const data = await Client.get('/leads');
            setLeads(data.items || []);
            setTotal(data.total || 0);
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

    const commentPreview = (lead: any) => {
        if (lead.original_comment) return lead.original_comment;
        if (lead.comment_id) return `Comment ID: ${lead.comment_id}`;
        return 'No comment available';
    };

    const stageBadge = (stage: string) => {
        const colors: Record<string, string> = {
            AWARENESS: 'bg-sky-100 text-sky-700',
            EVALUATING: 'bg-amber-100 text-amber-700',
            READY: 'bg-emerald-100 text-emerald-700',
        };
        return colors[stage] || 'bg-slate-100 text-slate-700';
    };

    const readyCount = leads.filter(lead => lead.buyer_stage === 'READY').length;

    const generateReply = async (leadId: string) => {
        setDraftGenerationLoadingId(leadId);
        try {
            await Client.post(`/leads/${leadId}/draft`, {});
            window.location.href = '/replies';
        } catch (e: any) {
            alert(e.message || 'Failed to generate reply');
        } finally {
            setDraftGenerationLoadingId(null);
        }
    };

    return (
        <div className="space-y-6">
            <section className="panel p-6 lg:p-8">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <div className="hero-kicker">Lead Opportunities</div>
                        <h1 className="hero-title mt-3">Focus on potential buyers, not just activity.</h1>
                        <p className="hero-copy">
                            Each row below is a buyer-signal record tied back to the original comment so the operator can judge urgency without guessing.
                        </p>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="metric-panel min-w-[180px]">
                            <div className="text-sm font-semibold text-slate-500">Total Leads</div>
                            <div className="mt-2 text-3xl font-bold">{total}</div>
                        </div>
                        <div className="metric-panel min-w-[180px]">
                            <div className="text-sm font-semibold text-slate-500">Ready to Buy</div>
                            <div className="mt-2 text-3xl font-bold">{readyCount}</div>
                        </div>
                    </div>
                </div>
            </section>

            <section className="grid gap-4 md:grid-cols-3">
                <div className="panel flex items-center gap-3 p-5">
                    <Target className="h-5 w-5 text-teal-700" />
                    <div className="text-sm text-slate-600">The original comment stays primary. IDs are secondary metadata.</div>
                </div>
                <div className="panel flex items-center gap-3 p-5">
                    <Sparkles className="h-5 w-5 text-amber-600" />
                    <div className="text-sm text-slate-600">Lead stage should help the operator choose outreach speed, not replace judgment.</div>
                </div>
                <div className="panel flex items-center gap-3 p-5">
                    <ShieldCheck className="h-5 w-5 text-emerald-700" />
                    <div className="text-sm text-slate-600">Confidence is shown as a signal weight, not as a guarantee.</div>
                </div>
            </section>

            <section className="table-shell overflow-x-auto">
                {loading ? (
                    <div className="p-8 text-slate-500">Loading leads...</div>
                ) : leads.length === 0 ? (
                    <div className="p-10 text-center text-slate-400">Leads will appear here once discovery captures buyer intent signals.</div>
                ) : (
                    <table className="min-w-full">
                        <thead className="table-head border-b border-slate-200">
                            <tr>
                                <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Platform</th>
                                <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Video</th>
                                <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Original Comment</th>
                                <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Intent</th>
                                <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Stage</th>
                                <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Confidence</th>
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
                                    <td className="px-4 py-4 text-xs font-mono text-slate-500">{lead.video_id?.substring(0, 16)}...</td>
                                    <td className="px-4 py-4 max-w-md text-sm text-slate-800">
                                        <div className="line-clamp-2" title={commentPreview(lead)}>
                                            {commentPreview(lead)}
                                        </div>
                                        {lead.user_handle && <div className="mt-2 text-xs text-slate-500">@{lead.user_handle}</div>}
                                    </td>
                                    <td className="px-4 py-4 text-sm font-semibold text-slate-700">{lead.intent || 'N/A'}</td>
                                    <td className="px-4 py-4 text-sm">
                                        <span className={`status-pill ${stageBadge(lead.buyer_stage)}`}>
                                            {lead.buyer_stage}
                                        </span>
                                    </td>
                                    <td className="px-4 py-4 text-sm">
                                        <span className={`status-pill ${lead.confidence > 0.7 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                            {(lead.confidence * 100).toFixed(0)}%
                                        </span>
                                    </td>
                                    <td className="px-4 py-4 text-sm whitespace-nowrap text-slate-500">{formatDate(lead.created_at)}</td>
                                    <td className="px-4 py-4 text-right">
                                        <button className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-teal-700 transition hover:bg-teal-50">
                                            View
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </section>

            {selectedLead && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"
                    onClick={() => setSelectedLead(null)}
                >
                    <div
                        className="panel-strong max-h-[80vh] w-full max-w-3xl overflow-auto"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="border-b border-slate-200 p-6">
                            <div className="hero-kicker">Lead Detail</div>
                            <h3 className="mt-2 text-xl font-bold">Buyer-signal review</h3>
                        </div>
                        <div className="space-y-5 p-6">
                            <div className="grid gap-4 md:grid-cols-2">
                                <DetailField label="Platform" value={selectedLead.platform} />
                                <DetailField
                                    label="Buyer Stage"
                                    value={<span className={`status-pill ${stageBadge(selectedLead.buyer_stage)}`}>{selectedLead.buyer_stage}</span>}
                                />
                                <DetailField label="Intent" value={selectedLead.intent || 'N/A'} />
                                <DetailField label="Confidence" value={`${(selectedLead.confidence * 100).toFixed(1)}%`} />
                            </div>

                            <DetailField label="Video ID" value={<div className="font-mono text-sm">{selectedLead.video_id}</div>} />
                            <DetailField label="Original Comment" value={<div className="whitespace-pre-wrap text-sm leading-7">{commentPreview(selectedLead)}</div>} />
                            <DetailField label="Comment ID" value={<div className="font-mono text-sm">{selectedLead.comment_id}</div>} />

                            {selectedLead.user_handle && (
                                <DetailField
                                    label="User"
                                    value={
                                        <div className="text-sm">
                                            @{selectedLead.user_handle}
                                            {selectedLead.user_profile_url && (
                                                <a
                                                    href={selectedLead.user_profile_url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="ml-2 font-semibold text-teal-700"
                                                >
                                                    View Profile
                                                </a>
                                            )}
                                        </div>
                                    }
                                />
                            )}

                            <div className="grid gap-4 md:grid-cols-2">
                                <DetailField label="Recommended Action" value={selectedLead.recommended_action || 'N/A'} />
                                <DetailField label="Created At" value={formatDate(selectedLead.created_at)} />
                            </div>

                            <DetailField label="Source Event" value={<div className="font-mono text-sm text-slate-600">{selectedLead.source_event_id}</div>} />

                            <div className="flex gap-3">
                                <button
                                    onClick={() => generateReply(selectedLead.id)}
                                    disabled={draftGenerationLoadingId === selectedLead.id}
                                    className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white"
                                >
                                    {draftGenerationLoadingId === selectedLead.id ? 'Generating...' : 'Generate Reply'}
                                </button>
                            </div>
                        </div>
                        <div className="border-t border-slate-200 p-6 text-right">
                            <button
                                onClick={() => setSelectedLead(null)}
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

function DetailField({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="panel p-4">
            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">{label}</div>
            <div className="mt-3 text-slate-800">{value}</div>
        </div>
    );
}
