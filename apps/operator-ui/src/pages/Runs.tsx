
import { useEffect, useState } from 'react';
import { Client } from '../lib/api';
import { Play, CheckCircle, AlertTriangle, XCircle, Clock } from 'lucide-react';

export function Runs() {
    const [runs, setRuns] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedRun, setSelectedRun] = useState<any | null>(null);

    const loadData = async () => {
        try {
            setLoading(true);
            const data = await Client.get('/runs');
            setRuns(data.runs || []);
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
        const styles: Record<string, { bg: string; text: string; icon: any }> = {
            COMPLETED: { bg: 'bg-green-100', text: 'text-green-800', icon: <CheckCircle className="w-4 h-4" /> },
            DEGRADED: { bg: 'bg-yellow-100', text: 'text-yellow-800', icon: <AlertTriangle className="w-4 h-4" /> },
            FAILED: { bg: 'bg-red-100', text: 'text-red-800', icon: <XCircle className="w-4 h-4" /> },
            RUNNING: { bg: 'bg-blue-100', text: 'text-blue-800', icon: <Play className="w-4 h-4" /> },
            PENDING: { bg: 'bg-gray-100', text: 'text-gray-800', icon: <Clock className="w-4 h-4" /> },
        };
        const style = styles[status] || styles.PENDING;
        return (
            <span className={`px-2 py-1 rounded text-xs font-bold flex items-center gap-1 ${style.bg} ${style.text}`}>
                {style.icon}
                {status}
            </span>
        );
    };

    return (
        <div className="flex h-full flex-col">
            {/* Toolbar */}
            <div className="p-4 border-b bg-white flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-bold flex items-center gap-2">
                        <Play className="w-6 h-6 text-blue-600" />
                        Automation Runs
                    </h2>
                    <p className="text-sm text-gray-500 mt-1">
                        View discovery run outcomes and execution stats
                    </p>
                </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-auto p-4">
                {loading ? (
                    <div className="text-center py-12 text-gray-500">Loading...</div>
                ) : runs.length === 0 ? (
                    <div className="text-center py-12">
                        <Play className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                        <h3 className="text-lg font-medium text-gray-600 mb-2">No Runs Yet</h3>
                        <p className="text-sm text-gray-500">
                            Automation runs will appear here once you trigger discovery
                        </p>
                    </div>
                ) : (
                    <table className="w-full bg-white border rounded shadow-sm">
                        <thead className="bg-gray-50 border-b">
                            <tr>
                                <th className="text-left p-3 text-sm font-semibold text-gray-500">Run ID</th>
                                <th className="text-left p-3 text-sm font-semibold text-gray-500">Brand</th>
                                <th className="text-left p-3 text-sm font-semibold text-gray-500">Status</th>
                                <th className="text-left p-3 text-sm font-semibold text-gray-500">Videos</th>
                                <th className="text-left p-3 text-sm font-semibold text-gray-500">Comments</th>
                                <th className="text-left p-3 text-sm font-semibold text-gray-500">Emitted</th>
                                <th className="text-left p-3 text-sm font-semibold text-gray-500">Started</th>
                                <th className="w-10"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {runs.map(run => {
                                const stats = run.stats || {};
                                return (
                                    <tr
                                        key={run.id}
                                        className="border-b hover:bg-gray-50 cursor-pointer"
                                        onClick={() => setSelectedRun(run)}
                                    >
                                        <td className="p-3 text-sm text-gray-600 font-mono">
                                            {run.id.substring(0, 8)}...
                                        </td>
                                        <td className="p-3 text-sm text-gray-800 font-medium">{run.brand_name || 'Unknown'}</td>
                                        <td className="p-3 text-sm">{statusBadge(run.status)}</td>
                                        <td className="p-3 text-sm text-gray-700">{stats.videos_processed || 0}</td>
                                        <td className="p-3 text-sm text-gray-700">{stats.comments_captured || 0}</td>
                                        <td className="p-3 text-sm">
                                            <span className="text-green-700">{stats.comments_emitted_success || 0}</span>
                                            {stats.comments_emitted_failed > 0 && (
                                                <span className="text-red-700 ml-1">/ {stats.comments_emitted_failed}</span>
                                            )}
                                        </td>
                                        <td className="p-3 text-sm text-gray-500 whitespace-nowrap">
                                            {formatDate(run.started_at)}
                                        </td>
                                        <td className="p-3 text-right">
                                            <button className="text-blue-600 text-sm font-medium">View</button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Detail Modal */}
            {selectedRun && (
                <div
                    className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50"
                    onClick={() => setSelectedRun(null)}
                >
                    <div
                        className="bg-white rounded-lg shadow-2xl max-w-3xl w-full mx-4 max-h-[80vh] overflow-auto"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="p-6 border-b">
                            <h3 className="text-lg font-bold flex items-center gap-2">
                                <Play className="w-5 h-5 text-blue-600" />
                                Run Details
                            </h3>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-semibold text-gray-500 uppercase">Run ID</label>
                                    <div className="text-sm font-mono bg-gray-50 p-2 rounded mt-1">{selectedRun.id}</div>
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-gray-500 uppercase">Status</label>
                                    <div className="mt-1">{statusBadge(selectedRun.status)}</div>
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-gray-500 uppercase">Platform</label>
                                    <div className="text-sm font-medium mt-1 uppercase">{selectedRun.platform}</div>
                                </div>
                                <div>
                                    <label className="text-xs font-semibold text-gray-500 uppercase">Brand ID</label>
                                    <div className="text-sm font-mono mt-1">{selectedRun.brand_id}</div>
                                </div>
                            </div>

                            <div className="border-t pt-4">
                                <h4 className="font-semibold mb-3">Execution Counts</h4>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="bg-blue-50 p-3 rounded">
                                        <div className="text-xs text-blue-600 font-semibold uppercase">Videos Processed</div>
                                        <div className="text-2xl font-bold text-blue-900 mt-1">
                                            {selectedRun.stats?.videos_processed || 0}
                                        </div>
                                    </div>
                                    <div className="bg-purple-50 p-3 rounded">
                                        <div className="text-xs text-purple-600 font-semibold uppercase">Comments Captured</div>
                                        <div className="text-2xl font-bold text-purple-900 mt-1">
                                            {selectedRun.stats?.comments_captured || 0}
                                        </div>
                                    </div>
                                    <div className="bg-green-50 p-3 rounded">
                                        <div className="text-xs text-green-600 font-semibold uppercase">Successfully Emitted</div>
                                        <div className="text-2xl font-bold text-green-900 mt-1">
                                            {selectedRun.stats?.comments_emitted_success || 0}
                                        </div>
                                    </div>
                                    <div className="bg-red-50 p-3 rounded">
                                        <div className="text-xs text-red-600 font-semibold uppercase">Emission Failures</div>
                                        <div className="text-2xl font-bold text-red-900 mt-1">
                                            {selectedRun.stats?.comments_emitted_failed || 0}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {selectedRun.abort_reason && (
                                <div className="bg-yellow-50 border border-yellow-200 p-3 rounded">
                                    <div className="text-xs font-semibold text-yellow-800 uppercase mb-1">Abort Reason</div>
                                    <div className="text-sm text-yellow-900">{selectedRun.abort_reason}</div>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <label className="text-xs font-semibold text-gray-500 uppercase">Started At</label>
                                    <div className="text-sm mt-1">{formatDate(selectedRun.started_at)}</div>
                                </div>
                                {selectedRun.ended_at && (
                                    <div>
                                        <label className="text-xs font-semibold text-gray-500 uppercase">Ended At</label>
                                        <div className="text-sm mt-1">{formatDate(selectedRun.ended_at)}</div>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="p-6 border-t flex justify-end">
                            <button
                                onClick={() => setSelectedRun(null)}
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
