
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
    cooldown_ms_between_actions: number;
    allow_capture_seen_events: boolean;
    notes?: string;
}

export const AutomationPolicySettings: React.FC = () => {
    const { brandId } = useParams<{ brandId: string }>();
    const [policy, setPolicy] = useState<Policy | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!brandId) return;
        loadPolicy();
    }, [brandId]);

    const loadPolicy = async () => {
        try {
            setLoading(true);
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

            // Allow user to toggle status via a separate button or implicit?
            // Here we just save updates.
            const updated = await api.put(`/brands/${brandId}/automation-policy`, policy);
            setPolicy(updated);
            alert("Policy updated successfully (New Version Created)");
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

    if (loading) return <div>Loading Policy...</div>;
    if (!policy) return <div>No Policy Found</div>;

    return (
        <div className="p-6 max-w-4xl mx-auto bg-white shadow rounded">
            <h2 className="text-2xl font-bold mb-4">Automation Policy</h2>

            <div className="mb-6 p-4 bg-gray-50 rounded border">
                <div className="flex justify-between items-center">
                    <div>
                        <span className="text-sm text-gray-500">Current Version: {policy.version}</span>
                        <div className="flex items-center gap-2 mt-1">
                            <span className={`px-2 py-1 text-xs font-bold rounded ${policy.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                                {policy.status}
                            </span>
                            <span className="text-xs font-mono">{policy.mode} MODE</span>
                        </div>
                    </div>
                    <button
                        onClick={() => handleChange('status', policy.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE')}
                        className={`px-4 py-2 rounded text-white font-bold ${policy.status === 'ACTIVE' ? 'bg-red-500' : 'bg-green-500'}`}
                    >
                        {policy.status === 'ACTIVE' ? 'PAUSE AUTOMATION' : 'ACTIVATE AUTOMATION'}
                    </button>
                </div>
            </div>

            {error && <div className="mb-4 p-3 bg-red-100 text-red-700 rounded">{error}</div>}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* GATING */}
                <section>
                    <h3 className="text-lg font-semibold mb-3">Relevance Gates</h3>
                    <div className="space-y-4">
                        <label className="block">
                            <span className="text-gray-700">Relevance Min Score (0-100)</span>
                            <input
                                type="number"
                                value={policy.relevance_min_score}
                                onChange={(e) => handleChange('relevance_min_score', parseInt(e.target.value))}
                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm border p-2"
                            />
                        </label>
                        <label className="block">
                            <span className="text-gray-700">Intent Min Score (0-100)</span>
                            <input
                                type="number"
                                value={policy.intent_min_score}
                                onChange={(e) => handleChange('intent_min_score', parseInt(e.target.value))}
                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm border p-2"
                            />
                        </label>
                        <label className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={policy.allow_capture_seen_events}
                                onChange={(e) => handleChange('allow_capture_seen_events', e.target.checked)}
                            />
                            <span>Log "Seen" events even if rejected</span>
                        </label>
                    </div>
                </section>

                {/* LIMITS */}
                <section>
                    <h3 className="text-lg font-semibold mb-3">Rate Limits</h3>
                    <div className="space-y-4">
                        <label className="block">
                            <span className="text-gray-700">Max Videos / Hour</span>
                            <input
                                type="number"
                                value={policy.max_videos_per_hour}
                                onChange={(e) => handleChange('max_videos_per_hour', parseInt(e.target.value))}
                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm border p-2"
                            />
                        </label>
                        <label className="block">
                            <span className="text-gray-700">Max Comments / Video</span>
                            <input
                                type="number"
                                value={policy.max_comments_per_video}
                                onChange={(e) => handleChange('max_comments_per_video', parseInt(e.target.value))}
                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm border p-2"
                            />
                        </label>
                        <label className="block">
                            <span className="text-gray-700">Max Leads / Day</span>
                            <input
                                type="number"
                                value={policy.max_leads_per_day}
                                onChange={(e) => handleChange('max_leads_per_day', parseInt(e.target.value))}
                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm border p-2"
                            />
                        </label>
                        <label className="block">
                            <span className="text-gray-700">Action Pacing (ms)</span>
                            <input
                                type="number"
                                value={policy.cooldown_ms_between_actions}
                                onChange={(e) => handleChange('cooldown_ms_between_actions', parseInt(e.target.value))}
                                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm border p-2"
                            />
                        </label>
                    </div>
                </section>
            </div>

            <div className="mt-8 flex justify-end">
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="bg-blue-600 text-white px-6 py-2 rounded font-bold hover:bg-blue-700 disabled:opacity-50"
                >
                    {saving ? 'Saving...' : 'Save New Version'}
                </button>
            </div>
        </div>
    );
};
