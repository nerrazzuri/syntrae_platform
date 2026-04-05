import { useState } from 'react';
import { Client } from '../lib/api';
import { X, Copy, ExternalLink, Check, MessageSquareQuote } from 'lucide-react';

interface Props {
    suggestion: any;
    onClose: () => void;
    onUpdate: () => void;
}

export function SuggestionDetail({ suggestion, onClose, onUpdate }: Props) {
    const [reason, setReason] = useState('');
    const [showRejectInput, setShowRejectInput] = useState(false);

    if (!suggestion) return null;

    const handleCopy = () => {
        navigator.clipboard.writeText(suggestion.suggested_text);
    };

    const handlePost = async () => {
        if (!confirm('Did you post this reply? This will resolve the suggestion.')) return;
        await Client.post(`/suggestions/${suggestion.id}/decision`, { decision: 'POST' });
        onUpdate();
        onClose();
    };

    const handleReject = async () => {
        if (!showRejectInput) {
            setShowRejectInput(true);
            return;
        }
        await Client.post(`/suggestions/${suggestion.id}/decision`, { decision: 'REJECT', reason });
        onUpdate();
        onClose();
    };

    const originalComment = suggestion.original_comment || suggestion.event?.content_text || 'No comment available';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
            <div className="panel-strong flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                    <div>
                        <div className="hero-kicker">Suggestion Review</div>
                        <h3 className="mt-2 text-xl font-bold">Draft approval workspace</h3>
                    </div>
                    <button onClick={onClose} className="rounded-2xl p-2 text-slate-500 transition hover:bg-slate-100">
                        <X className="h-5 w-5" />
                    </button>
                </div>

                <div className="flex-1 space-y-6 overflow-y-auto p-6">
                    <div className="text-xs font-mono text-slate-400">ID: {suggestion.id}</div>
                    {suggestion.thread_reference?.thread_url && (
                        <a
                            href={suggestion.thread_reference.thread_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700"
                        >
                            <ExternalLink className="h-4 w-4" />
                            Open original post or thread
                        </a>
                    )}

                    <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                        <div className="panel p-4">
                            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
                                <MessageSquareQuote className="h-3.5 w-3.5 text-teal-700" />
                                Original Comment
                            </div>
                            <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-800">{originalComment}</p>
                            {suggestion.event?.metadata && (
                                <div className="mt-4 flex items-center gap-1 text-xs font-semibold text-teal-700">
                                    <ExternalLink className="h-3 w-3" />
                                    Context attached from source event
                                </div>
                            )}
                        </div>

                        <div className="space-y-4">
                            {suggestion.explanation && (
                                <div className="panel p-4">
                                    <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">AI Analysis</div>
                                    <p className="mt-3 text-sm leading-6 text-slate-700">{suggestion.explanation.summary}</p>
                                    <div className="mt-4 flex flex-wrap gap-2 text-xs">
                                        <span className="status-pill bg-teal-100 text-teal-700">
                                            Intent: {suggestion.explanation.detected_intent}
                                        </span>
                                        <span className="status-pill bg-amber-100 text-amber-700">
                                            {(suggestion.confidence * 100).toFixed(0)}% confidence
                                        </span>
                                    </div>
                                </div>
                            )}

                            <div className="panel p-4">
                                <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Operator Guidance</div>
                                <p className="mt-3 text-sm leading-6 text-slate-600">
                                    Keep replies specific to the original comment. If the draft sounds generic, reject it and record why.
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="panel p-5">
                        <div className="mb-3 flex items-center justify-between">
                            <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Suggested Reply</div>
                            <button onClick={handleCopy} className="flex items-center gap-1 text-sm font-semibold text-teal-700 transition hover:text-teal-800">
                                <Copy className="h-3.5 w-3.5" />
                                Copy
                            </button>
                        </div>
                        <div className="rounded-2xl border border-teal-100 bg-white px-4 py-5 text-lg leading-8 text-slate-900 shadow-sm">
                            {suggestion.suggested_text}
                        </div>
                    </div>

                    {showRejectInput && (
                        <div className="panel border-rose-200 p-4">
                            <label className="block text-sm font-semibold text-rose-700">Rejection Reason</label>
                            <textarea
                                className="surface-input mt-3 min-h-28 border-rose-200"
                                placeholder="Why is this suggestion not good enough to ship?"
                                value={reason}
                                onChange={e => setReason(e.target.value)}
                            />
                        </div>
                    )}
                </div>

                <div className="flex flex-col gap-3 border-t border-slate-200 bg-[rgba(247,244,238,0.92)] px-5 py-4 sm:flex-row sm:justify-end">
                    <button
                        onClick={handleReject}
                        className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-100"
                    >
                        {showRejectInput ? 'Confirm Reject' : 'Reject'}
                    </button>
                    {!showRejectInput && (
                        <button
                            onClick={handlePost}
                            className="flex items-center justify-center gap-2 rounded-2xl bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-800"
                        >
                            <Check className="h-4 w-4" />
                            Mark as Posted
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
