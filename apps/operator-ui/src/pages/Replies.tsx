import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, DraftFeedbackApi } from '../lib/api';
import { PaginationControls } from '../components/PaginationControls';

const REJECTION_REASONS = [
    { value: 'TOO_AI', label: 'Too AI' },
    { value: 'TOO_GENERIC', label: 'Too generic' },
    { value: 'TOO_SALESY', label: 'Too salesy' },
    { value: 'WRONG_INTENT', label: 'Wrong intent' },
    { value: 'MISSED_USER_QUESTION', label: 'Missed question' },
    { value: 'CTA_SHOULD_NOT_BE_INCLUDED', label: 'CTA should not be included' },
    { value: 'CTA_MISSING', label: 'CTA missing' },
    { value: 'WRONG_LANGUAGE', label: 'Wrong language' },
    { value: 'TOO_LONG', label: 'Too long' },
    { value: 'TOO_SHORT', label: 'Too short' },
    { value: 'UNSAFE_CLAIM', label: 'Unsafe claim' },
    { value: 'PRODUCT_INFO_WRONG', label: 'Product info wrong' },
    { value: 'NOT_BRAND_VOICE', label: 'Not brand voice' },
    { value: 'OTHER', label: 'Other' },
];

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
    const [approving, setApproving] = useState(false);
    const [rejecting, setRejecting] = useState(false);
    const [rejectReasons, setRejectReasons] = useState<string[]>([]);
    const [rejectNote, setRejectNote] = useState('');
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
        setRejectReasons([]);
        setRejectNote('');
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

    function finalReviewText(draft: any) {
        return String(editText || draft?.edited_text || draft?.draft_text || '').trim();
    }

    function isEditedDecision(draft: any, text: string) {
        const originalText = String(draft?.draft_text || '').trim();
        const savedEditedText = String(draft?.edited_text || '').trim();
        return Boolean(savedEditedText) || text !== originalText || draft?.status === 'EDITED';
    }

    async function recordReviewDecision(draft: any, decisionAction: string, finalText: string) {
        const edited = isEditedDecision(draft, finalText);
        await DraftFeedbackApi.record(draft.id, {
            feedback_type: edited ? 'EDITED_BEFORE_SEND' : 'ACCEPTED_AS_IS',
            selected_reasons: edited ? [] : ['GOOD_REPLY'],
            human_edited_text: edited ? finalText : undefined,
            final_sent_text: finalText,
            metadata: {
                source: 'replies_ui',
                decision_action: decisionAction,
            },
        });
    }

    async function approveDraft() {
        if (!selectedDraft) return;
        setApproving(true);
        setSendError(null);
        setSendSuccess(null);
        try {
            const finalText = finalReviewText(selectedDraft);
            const savedText = String(selectedDraft.edited_text || selectedDraft.draft_text || '').trim();
            let draftForDecision = selectedDraft;
            if (finalText && finalText !== savedText && selectedDraft.status !== 'REJECTED') {
                draftForDecision = await api.post(`/drafts/${selectedDraft.id}/edit`, { edited_text: finalText });
            }
            await api.post(`/drafts/${selectedDraft.id}/approve`, {});
            await recordReviewDecision(
                draftForDecision,
                isEditedDecision(draftForDecision, finalText) ? 'approve_after_edit' : 'approve_as_is',
                finalText,
            );
            setSendSuccess('Approval feedback recorded for Learning Review.');
            await loadDrafts();
        } catch (err: any) {
            setSendError(err.message || 'Failed to approve draft.');
        } finally {
            setApproving(false);
        }
    }

    async function rejectDraft() {
        if (!selectedDraft) return;
        if (rejectReasons.length === 0) {
            setSendError('Choose at least one rejection reason.');
            return;
        }

        setRejecting(true);
        setSendError(null);
        setSendSuccess(null);
        try {
            const payload = {
                reason: rejectNote || `Rejected: ${rejectReasons.join(', ')}`,
                selected_reasons: rejectReasons,
                feedback_note: rejectNote || undefined,
                human_edited_text:
                    editText.trim() && editText.trim() !== String(selectedDraft.draft_text || '').trim()
                        ? editText
                        : undefined,
                metadata: {
                    source: 'replies_ui',
                    decision_action: 'reject',
                },
            };
            if (selectedDraft.status === 'REJECTED') {
                await DraftFeedbackApi.record(selectedDraft.id, {
                    feedback_type: 'REJECTED',
                    selected_reasons: rejectReasons,
                    feedback_note: rejectNote || undefined,
                    human_edited_text: payload.human_edited_text,
                    metadata: payload.metadata,
                });
            } else {
                await api.post(`/drafts/${selectedDraft.id}/reject`, payload);
            }
            if (selectedDraft.status === 'REJECTED') {
                setSendSuccess('Rejection feedback recorded.');
            } else {
                syncSelectedDraft(null);
            }
            await loadDrafts();
        } catch (err: any) {
            setSendError(err.message || 'Failed to reject draft.');
        } finally {
            setRejecting(false);
        }
    }

    function toggleRejectReason(value: string) {
        setRejectReasons((current) => (
            current.includes(value)
                ? current.filter((item) => item !== value)
                : [...current, value]
        ));
    }

    async function sendDraft() {
        if (!selectedDraft) return;
        setSendError(null);
        setSendSuccess(null);
        setSending(true);
        try {
            const finalText = String(selectedDraft.edited_text || selectedDraft.draft_text || '').trim();
            await api.post(`/drafts/${selectedDraft.id}/send`, {});
            await recordReviewDecision(selectedDraft, 'send_to_thread', finalText);
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

                            {selectedDraft.status !== 'SENT' && (
                                <div className="rounded-2xl border border-rose-100 bg-rose-50/60 px-4 py-4">
                                    <div className="text-xs font-semibold uppercase tracking-[0.24em] text-rose-500">Reject Reason</div>
                                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                        {REJECTION_REASONS.map((reason) => (
                                            <label
                                                key={reason.value}
                                                className={`flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition ${rejectReasons.includes(reason.value)
                                                    ? 'border-rose-300 bg-white text-rose-800'
                                                    : 'border-rose-100 bg-white/60 text-slate-600'
                                                    }`}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={rejectReasons.includes(reason.value)}
                                                    onChange={() => toggleRejectReason(reason.value)}
                                                />
                                                {reason.label}
                                            </label>
                                        ))}
                                    </div>
                                    <textarea
                                        className="mt-3 min-h-[80px] w-full rounded-2xl border border-rose-100 bg-white px-4 py-3 text-sm"
                                        value={rejectNote}
                                        onChange={(event) => setRejectNote(event.target.value)}
                                        placeholder="Optional note for Learning Review"
                                    />
                                </div>
                            )}

                            <div className="flex flex-wrap gap-3">
                                <button onClick={saveEdit} className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700">
                                    Save Edit
                                </button>
                                <button
                                    onClick={approveDraft}
                                    disabled={approving}
                                    className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                                    title={isEditedDecision(selectedDraft, editText) ? 'Will record as EDITED_BEFORE_SEND' : 'Will record as ACCEPTED_AS_IS'}
                                >
                                    {approving
                                        ? 'Approving…'
                                        : isEditedDecision(selectedDraft, editText)
                                            ? 'Approve (edited)'
                                            : 'Approve (as-is)'}
                                </button>
                                <button
                                    onClick={sendDraft}
                                    disabled={sending}
                                    className="rounded-2xl border border-teal-200 bg-teal-50 px-4 py-2.5 text-sm font-semibold text-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
                                    title={isEditedDecision(selectedDraft, editText) ? 'Will record as EDITED_BEFORE_SEND' : 'Will record as ACCEPTED_AS_IS'}
                                >
                                    {sending ? 'Sending…' : 'Send to Thread'}
                                </button>
                                {selectedDraft.status !== 'SENT' && (
                                    <button
                                        onClick={rejectDraft}
                                        disabled={rejecting}
                                        className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        {rejecting
                                            ? (selectedDraft.status === 'REJECTED' ? 'Recording…' : 'Rejecting…')
                                            : (selectedDraft.status === 'REJECTED' ? 'Record feedback' : 'Reject')}
                                    </button>
                                )}
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
