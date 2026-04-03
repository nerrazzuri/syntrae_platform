import { useEffect, useState } from 'react';
import { Client } from '../lib/api';
import { SuggestionDetail } from '../components/SuggestionDetail';
import { MessageSquareText, Wand2 } from 'lucide-react';

export function Suggestions() {
    const [suggestions, setSuggestions] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('PENDING');
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const loadData = async () => {
        try {
            setLoading(true);
            const data = await Client.get(`/suggestions?status=${filter}`);
            setSuggestions(data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, [filter]);

    const [detailData, setDetailData] = useState<any>(null);
    useEffect(() => {
        if (selectedId) {
            Client.get(`/suggestions/${selectedId}`).then(setDetailData);
        } else {
            setDetailData(null);
        }
    }, [selectedId]);

    const commentPreview = (suggestion: any) => {
        return suggestion.original_comment || suggestion.event?.content_text || `Event ID: ${suggestion.event_id}`;
    };

    return (
        <div className="space-y-6">
            <section className="panel p-6 lg:p-8">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <div className="hero-kicker">Suggestions Queue</div>
                        <h1 className="hero-title mt-3">Review generated replies with the original comment in full context.</h1>
                        <p className="hero-copy">
                            This queue is where the operator approves, rejects, and pressure-tests AI drafting before anything becomes customer-facing.
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {['PENDING', 'RESOLVED', 'REJECTED'].map(f => (
                            <button
                                key={f}
                                onClick={() => setFilter(f)}
                                className={`filter-chip ${filter === f ? 'filter-chip-active' : 'filter-chip-idle'}`}
                            >
                                {f}
                            </button>
                        ))}
                    </div>
                </div>
            </section>

            <section className="grid gap-4 md:grid-cols-3">
                <div className="metric-panel">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm font-semibold text-slate-500">Visible Suggestions</div>
                            <div className="mt-2 text-3xl font-bold">{suggestions.length}</div>
                        </div>
                        <MessageSquareText className="h-5 w-5 text-teal-700" />
                    </div>
                </div>
                <div className="metric-panel">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm font-semibold text-slate-500">Current Filter</div>
                            <div className="mt-2 text-3xl font-bold">{filter}</div>
                        </div>
                        <Wand2 className="h-5 w-5 text-amber-600" />
                    </div>
                </div>
                <div className="panel flex items-center p-5 text-sm text-slate-600">
                    Keep the comment visible when reviewing tone. The operator should never have to infer context from an `event_id`.
                </div>
            </section>

            <section className="table-shell overflow-x-auto">
                {loading ? (
                    <div className="p-8 text-slate-500">Loading suggestions...</div>
                ) : (
                    <table className="min-w-full">
                        <thead className="table-head border-b border-slate-200">
                            <tr>
                                <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Time</th>
                                <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Platform</th>
                                <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Original Comment</th>
                                <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Suggestion</th>
                                <th className="px-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Confidence</th>
                                <th className="px-4 py-4"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {suggestions.map(s => (
                                <tr
                                    key={s.id}
                                    className="table-row cursor-pointer border-b border-slate-100"
                                    onClick={() => setSelectedId(s.id)}
                                >
                                    <td className="px-4 py-4 text-sm text-slate-500 whitespace-nowrap">
                                        {new Date(s.created_at).toLocaleTimeString()}
                                    </td>
                                    <td className="px-4 py-4 text-sm font-semibold uppercase text-slate-600">{s.platform}</td>
                                    <td className="px-4 py-4 text-sm text-slate-800 max-w-md">
                                        <div className="line-clamp-2" title={commentPreview(s)}>
                                            {commentPreview(s)}
                                        </div>
                                    </td>
                                    <td className="px-4 py-4 text-sm font-semibold text-slate-900 max-w-md">
                                        <div className="line-clamp-2">{s.suggested_text}</div>
                                    </td>
                                    <td className="px-4 py-4 text-sm">
                                        <span className={`status-pill ${s.confidence > 0.8 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                                            {(s.confidence * 100).toFixed(0)}%
                                        </span>
                                    </td>
                                    <td className="px-4 py-4 text-right">
                                        <button className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-teal-700 transition hover:bg-teal-50">
                                            Review
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {suggestions.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-4 py-10 text-center text-slate-400">
                                        No suggestions found for this filter.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                )}
            </section>

            {selectedId && detailData && (
                <SuggestionDetail
                    suggestion={detailData}
                    onClose={() => setSelectedId(null)}
                    onUpdate={loadData}
                />
            )}
        </div>
    );
}
