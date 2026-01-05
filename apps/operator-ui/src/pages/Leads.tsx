
import { useEffect, useState } from 'react';
import { Client } from '../lib/api';
import { Target } from 'lucide-react';

export function Leads() {
    const [leads, setLeads] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [total, setTotal] = useState(0);
    const [selectedLead, setSelectedLead] = useState<any | null>(null);

    const loadData = async () => {
        try {
            setLoading(true);
            const data = await Client.get('/leads');
            // API returns {items, total, limit, offset}
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

    const stageBadge = (stage: string) => {
        // Match actual BuyerStage enum: AWARENESS, EVALUATING, READY
        const colors: Record<string, string> = {
            AWARENESS: 'bg-blue-100 text-blue-700',
            EVALUATING: 'bg-purple-100 text-purple-700',
            READY: 'bg-green-100 text-green-700',
        };
        return colors[stage] || 'bg-gray-100 text-gray-700';
    };

    return (
        <div className="flex h-full flex-col">
            {/* Toolbar */}
            <div className="p-4 border-b bg-white flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <Target className="w-6 h-6 text-green-600" />
                        Lead Opportunities
                    </h2>
                    <p className="text-sm text-gray-500 mt-1">
                        {total} total leads captured from automation
                    </p>
                </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-auto p-4">
                {loading ? (
                    <div className="text-center py-12 text-gray-500">Loading...</div>
                ) : leads.length === 0 ? (
                    <div className="text-center py-12">
                        <Target className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                        <h3 className="text-lg font-medium text-gray-600 mb-2">No Leads Yet</h3>
                        <p className="text-sm text-gray-500">
                            Leads will appear here once discovery captures buyer intent signals
                        </p>
                    </div>
                ) : (
                    <table className="w-full bg-white border rounded shadow-sm">
                        <thead className="bg-gray-50 border-b">
                            <tr>
                                <th className="text-left p-3 text-sm font-semibold text-gray-500">Platform</th>
                                <th className="text-left p-3 text-sm font-semibold text-gray-500">Video ID</th>
                                <th className="text-left p-3 text-sm font-semibold text-gray-500">Comment</th>
                                <th className="text-left p-3 text-sm font-semibold text-gray-500">Intent</th>
                                <th className="text-left p-3 text-sm font-semibold text-gray-500">Stage</th>
                                <th className="text-left p-3 text-sm font-semibold text-gray-500">Confidence</th>
                                <th className="text-left p-3 text-sm font-semibold text-gray-500">Created</th>
                                <th className="w-10"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {leads.map(lead => (
                                <tr
                                    key={lead.id}
                                    className="border-b hover:bg-gray-50 cursor-pointer"
                                    onClick={() => setSelectedLead(lead)}
                                >
                                    <td className="p-3 text-sm text-gray-600 uppercase">{lead.platform}</td>
                                    <td className="p-3 text-sm text-gray-600 font-mono text-xs">
                                        {lead.video_id?.substring(0, 12)}...
                                    </td>
                                    <td className="p-3 text-sm text-gray-800 max-w-xs truncate">
                                        {lead.user_handle ? `@${lead.user_handle}: ` : ''}
                                        {lead.comment_id.substring(0, 40)}...
                                    </td>
                                    <td className="p-3 text-sm text-gray-700">{lead.intent || 'N/A'}</td>
                                    <td className="p-3 text-sm">
                                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${stageBadge(lead.buyer_stage)}`}>
                                            {lead.buyer_stage}
                                        </span>
                                    </td>
                                    <td className="p-3 text-sm">
                                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${lead.confidence > 0.7 ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                                            {(lead.confidence * 100).toFixed(0)}%
                                        </span>
                                    </td>
                                    <td className="p-3 text-sm text-gray-500 whitespace-nowrap">
                                        {formatDate(lead.created_at)}
                                    </td>
                                    <td className="p-3 text-right">
                                        <button className="text-blue-600 text-sm font-medium">View</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Detail Drawer */}
            {selectedLead && (
                <div
                    className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50"
                    onClick={() => setSelectedLead(null)}
                >
                    <div
                        className="bg-white rounded-lg shadow-2xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-auto"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="p-6 border-b">
                            <h3 className="text-lg font-bold flex items-center gap-2">
                                <Target className="w-5 h-5 text-green-600" />
                                Lead Details
                            </h3>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-semibold text-gray-500 uppercase">Platform</label>
                                    <div className="text-sm font-medium mt-1">{selectedLead.platform}</div>
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-gray-500 uppercase">Buyer Stage</label>
                                    <div className="mt-1">
                                        <span className={`px-2 py-1 rounded text-sm font-bold ${stageBadge(selectedLead.buyer_stage)}`}>
                                            {selectedLead.buyer_stage}
                                        </span>
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-gray-500 uppercase">Intent</label>
                                    <div className="text-sm font-medium mt-1">{selectedLead.intent || 'N/A'}</div>
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-gray-500 uppercase">Confidence</label>
                                    <div className="text-sm font-medium mt-1">{(selectedLead.confidence * 100).toFixed(1)}%</div>
                                </div>
                            </div>

                            <div>
                                <label className="text-xs font-semibold text-gray-500 uppercase">Video ID</label>
                                <div className="text-sm font-mono bg-gray-50 p-2 rounded mt-1">{selectedLead.video_id}</div>
                            </div>

                            <div>
                                <label className="text-xs font-semibold text-gray-500 uppercase">Comment ID</label>
                                <div className="text-sm font-mono bg-gray-50 p-2 rounded mt-1">{selectedLead.comment_id}</div>
                            </div>

                            {selectedLead.user_handle && (
                                <div>
                                    <label className="text-xs font-semibold text-gray-500 uppercase">User</label>
                                    <div className="text-sm mt-1">
                                        @{selectedLead.user_handle}
                                        {selectedLead.user_profile_url && (
                                            <a
                                                href={selectedLead.user_profile_url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="ml-2 text-blue-600 text-xs"
                                            >
                                                View Profile
                                            </a>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div>
                                <label className="text-xs font-semibold text-gray-500 uppercase">Recommended Action</label>
                                <div className="text-sm font-medium mt-1">{selectedLead.recommended_action || 'N/A'}</div>
                            </div>

                            <div>
                                <label className="text-xs font-semibold text-gray-500 uppercase">Source Event</label>
                                <div className="text-sm font-mono text-gray-600 mt-1">{selectedLead.source_event_id}</div>
                            </div>

                            <div>
                                <label className="text-xs font-semibold text-gray-500 uppercase">Created At</label>
                                <div className="text-sm text-gray-600 mt-1">{formatDate(selectedLead.created_at)}</div>
                            </div>
                        </div>
                        <div className="p-6 border-t flex justify-end">
                            <button
                                onClick={() => setSelectedLead(null)}
                                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded font-medium"
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
