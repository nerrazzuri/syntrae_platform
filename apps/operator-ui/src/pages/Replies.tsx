import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { PaginationControls } from '../components/PaginationControls';

export function RepliesPage() {
    const [drafts, setDrafts] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [total, setTotal] = useState(0);
    const [selectedDraft, setSelectedDraft] = useState<any | null>(null);
    const [editText, setEditText] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [sendError, setSendError] = useState<string | null>(null);
    const [sendSuccess, setSendSuccess] = useState<string | null>(null);
    const [sending, setSending] = useState(false);
    const [filter, setFilter] = useState('PENDING');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [searchParams, setSearchParams] = useSearchParams();
    const requestedDraftId = useMemo(() => searchParams.get('draft') || '', [searchParams]);
    const requestedStatus = useMemo(() => (searchParams.get('status') || '').toUpperCase(), [searchParams]);

    function syncSelectedDraft(draft: any | null) {
        setSelectedDraft(draft);
        setEditText(draft?.edited_text || draft?.draft_text || '');
        setSendError(null);
        setSendSuccess(null);
    }

    async function loadDrafts() {
        setLoading(true);
        setError(null);
        try {
            const offset = (page - 1) * pageSize;
            const data = await api.get(`/drafts?status=${filter}&limit=${pageSize}&offset=${offset}`) as {
                items?: any[];
                total?: number;
            };
            const items = Array.isArray(data?.items) ? data.items : [];
            setDrafts(items);
            setTotal(data?.total || 0);

            if (requestedDraftId) {
                const requested = items.find((item) => item.id === requestedDraftId) || null;
                if (requested) {
                    syncSelectedDraft(requested);
                    return;
                }
            }

            if (selectedDraft) {
                const updated = items.find((item) => item.id === selectedDraft.id) || null;
                syncSelectedDraft(updated);
            }
        } catch (err: any) {
            setError(err.message || 'Failed to load pending replies');
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        setPage(1);
    }, [filter]);

    useEffect(() => {
        if (requestedStatus && requestedStatus !== filter) {
            setFilter(requestedStatus);
            return;
        }
        loadDrafts();
    }, [filter, page, pageSize, requestedStatus, requestedDraftId]);

    function openDraft(draft: any) {
        syncSelectedDraft(draft);
        setSearchParams((current) => {
            const next = new URLSearchParams(current);
            next.set('draft', draft.id);
            next.set('status', filter);
            next.set('page', String(page));
            return next;
        });
    }

    async function saveEdit() {
        if (!selectedDraft) return;
        await api.post(`/drafts/${selectedDraft.id}/edit`, { edited_text: editText });
        await loadDrafts();
    }

    async function approveDraft() {
        if (!selectedDraft) return;
        await api.post(`/drafts/${selectedDraft.id}/approve`, {});
        await loadDrafts();
    }

    async function rejectDraft() {
        if (!selectedDraft) return;
        await api.post(`/drafts/${selectedDraft.id}/reject`, { reason: 'Rejected by operator' });
        syncSelectedDraft(null);
        await loadDrafts();
    }

    async function sendDraft() {
        if (!selectedDraft) return;
        setSendError(null);
        setSendSuccess(null);
        setSending(true);
        try {
            await api.post(`/drafts/${selectedDraft.id}/send`, {});
            setSendSuccess('Reply sent to the live thread.');
        } catch (err: any) {
            setSendError(err.message || 'Failed to send thread reply.');
            setSending(false);
            return;
        }
        await loadDrafts();
        setSending(false);
    }

    return (
        <div className="space-y-6">
            <section className="panel p-6 lg:p-8">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <div className="hero-kicker">Reply Inbox</div>
                        <h1 className="hero-title mt-3">Pending public replies for business-owner review.</h1>
                        <p className="hero-copy">
                            These are AI-generated, same-language public replies designed to answer once and redirect users toward the business owner’s store or profile.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {['PENDING', 'APPROVED', 'SENT', 'REJECTED'].map(value => (
                            <button
                                key={value}
                                onClick={() => setFilter(value)}
                                className={`filter-chip ${filter === value ? 'filter-chip-active' : 'filter-chip-idle'}`}
                            >
                                {value}
                            </button>
                        ))}
                    </div>
                </div>
            </section>

            {error && <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

            <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
                <section className="table-shell overflow-x-auto">
                    {loading ? (
                        <div className="p-8 text-slate-500">Loading replies...</div>
                    ) : drafts.length === 0 ? (
                        <div className="p-10 text-center text-slate-400">No replies in this queue yet.</div>
                    ) : (
                        <>
                            <table className="min-w-full">
                                <thead className="table-head border-b border-slate-200">
                                    <tr>
                                        <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Brand</th>
                                        <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Thread</th>
                                        <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Original Comment</th>
                                        <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Suggested Reply</th>
                                        <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {drafts.map(draft => {
                                        const isSelected = selectedDraft?.id === draft.id || requestedDraftId === draft.id;
                                        return (
                                            <tr
                                                key={draft.id}
                                                className={`table-row cursor-pointer border-b border-slate-100 transition ${isSelected ? 'bg-teal-100 ring-1 ring-inset ring-teal-300' : ''}`}
                                                onClick={() => openDraft(draft)}
                                            >
                                        <td className={`px-4 py-4 text-sm font-semibold ${isSelected ? 'border-l-4 border-teal-600 bg-teal-100 text-teal-950' : 'text-slate-800'}`}>{draft.brand?.name || 'Unknown Brand'}</td>
                                        <td className="px-4 py-4 text-xs text-slate-600">
                                            <div className="font-semibold uppercase">{draft.thread_reference?.platform || draft.platform}</div>
                                            <div className="mt-1 font-mono">video: {draft.thread_reference?.video_id || 'unknown'}</div>
                                            <div className="mt-1 font-mono">comment: {draft.thread_reference?.comment_id || 'unknown'}</div>
                                            {draft.thread_reference?.thread_url && (
                                                <a
                                                    href={draft.thread_reference.thread_url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="mt-2 inline-block font-semibold text-teal-700"
                                                >
                                                    Open source post
                                                </a>
                                            )}
                                        </td>
                                        <td className="px-4 py-4 max-w-md text-sm text-slate-700">
                                            <div className="line-clamp-2">{draft.original_comment || 'No comment text available'}</div>
                                        </td>
                                        <td className="px-4 py-4 max-w-md text-sm font-semibold text-slate-900">
                                            <div className="line-clamp-2">{draft.edited_text || draft.draft_text}</div>
                                        </td>
                                        <td className="px-4 py-4 text-sm text-slate-600">
                                            <span className={`rounded-full px-2 py-1 font-semibold ${isSelected ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'}`}>
                                                {draft.status}
                                            </span>
                                        </td>
                                            </tr>
                                        );
                                    })}
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
                                label="replies"
                            />
                        </>
                    )}
                </section>

                <section className="panel-strong p-6">
                    {!selectedDraft ? (
                        <div className="text-sm text-slate-500">Select a reply from the queue to review and edit it.</div>
                    ) : (
                        <div className="space-y-5">
                            <div>
                                <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Original Comment</div>
                                <div className="mt-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                                    {selectedDraft.original_comment || 'No comment text available'}
                                </div>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-2">
                                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                                    <div className="font-semibold text-slate-900">Language</div>
                                    <div className="mt-1">{selectedDraft.language || 'Unknown'}</div>
                                </div>
                                <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                                    <div className="font-semibold text-slate-900">CTA Target</div>
                                    <div className="mt-1">{selectedDraft.cta_target || 'STORE'}</div>
                                </div>
                            </div>

                            <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                                <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Thread Target</div>
                                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                    <div>
                                        <div className="font-semibold text-slate-900">Platform</div>
                                        <div className="mt-1">{selectedDraft.thread_reference?.platform || selectedDraft.platform}</div>
                                    </div>
                                    <div>
                                        <div className="font-semibold text-slate-900">User</div>
                                        <div className="mt-1">
                                            {selectedDraft.thread_reference?.user_handle ? `@${selectedDraft.thread_reference.user_handle}` : 'Unknown'}
                                            {selectedDraft.thread_reference?.user_profile_url && (
                                                <a
                                                    href={selectedDraft.thread_reference.user_profile_url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="ml-2 font-semibold text-teal-700"
                                                >
                                                    Open profile
                                                </a>
                                            )}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="font-semibold text-slate-900">Source Post ID</div>
                                        <div className="mt-1 break-all font-mono text-xs">{selectedDraft.thread_reference?.video_id || 'Unknown'}</div>
                                    </div>
                                    <div>
                                        <div className="font-semibold text-slate-900">Comment ID</div>
                                        <div className="mt-1 break-all font-mono text-xs">{selectedDraft.thread_reference?.comment_id || 'Unknown'}</div>
                                    </div>
                                </div>
                                {String(selectedDraft.thread_reference?.comment_id || '').startsWith('xhs-cmt-fb-') && (
                                    <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                                        This XHS item uses a fallback comment identifier from discovery capture. Direct thread reply may not be available unless the platform returned a stable comment ID.
                                    </div>
                                )}
                                {selectedDraft.thread_reference?.thread_url && (
                                    <div className="mt-4">
                                        <a
                                            href={selectedDraft.thread_reference.thread_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="font-semibold text-teal-700"
                                        >
                                            Open live post/thread context
                                        </a>
                                    </div>
                                )}
                            </div>

                            <div>
                                <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">Reply Text</div>
                                <textarea
                                    className="mt-3 min-h-[180px] w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm"
                                    value={editText}
                                    onChange={(event) => setEditText(event.target.value)}
                                />
                            </div>

                            <div className="flex flex-wrap gap-3">
                                <button onClick={saveEdit} className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700">
                                    Save Edit
                                </button>
                                <button onClick={approveDraft} className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">
                                    Approve
                                </button>
                                <button
                                    onClick={sendDraft}
                                    disabled={sending}
                                    className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-2.5 text-sm font-semibold text-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                    {sending ? 'Sending…' : 'Send to Thread'}
                                </button>
                                <button onClick={rejectDraft} className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700">
                                    Reject
                                </button>
                            </div>
                            {sendError && (
                                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                                    {sendError}
                                </div>
                            )}
                            {sendSuccess && (
                                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                                    {sendSuccess}
                                </div>
                            )}
                            <div className="text-xs text-slate-500">
                                The queue is live. Direct thread delivery still needs a real platform connector; until then, the send action will tell you whether delivery is configured.
                            </div>
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}
