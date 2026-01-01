import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../lib/api';

// Enums
const MARKET_CATEGORIES = [
    "SKINCARE", "BEAUTY", "FITNESS", "SAAS", "EDUCATION", "LOCAL_SERVICE", "ECOM_GENERAL"
];

const DISCOVERY_INTENTS = [
    "CONSERVATIVE", "BALANCED", "AGGRESSIVE"
];

// Interface matching DB
interface MarketProfile {
    id: string;
    name: string;
    version: number;
    status: 'DRAFT' | 'READY' | 'ACTIVE';
    primary_category: string;
    target_audience: string;
    languages: string[];
    keywords_positive: string[];
    keywords_negative: string[];
    hashtags_positive: string[];
    hashtags_negative: string[];
    excluded_topics: string[];
    discovery_intent: string;
    quality_score: number;
    validation_warnings: string[];
    is_active: boolean;
    acceptance_threshold?: number;
    weight_keyword?: number;
    weight_hashtag?: number;
}

const DEFAULT_PROFILE: Partial<MarketProfile> = {
    name: "New Profile",
    primary_category: "ECOM_GENERAL",
    target_audience: "",
    languages: ["en"],
    keywords_positive: [],
    keywords_negative: [],
    hashtags_positive: [],
    hashtags_negative: [],
    excluded_topics: [],
    discovery_intent: "BALANCED",
    weight_keyword: 0.3,
    weight_hashtag: 0.2
};

export const MarketProfiles: React.FC = () => {
    const { brandId } = useParams<{ brandId: string }>();
    const [profiles, setProfiles] = useState<MarketProfile[]>([]);
    const [loading, setLoading] = useState(true);

    const [editing, setEditing] = useState<Partial<MarketProfile> | null>(null);
    const [isNew, setIsNew] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (brandId) loadProfiles();
    }, [brandId]);

    const loadProfiles = async () => {
        setLoading(true);
        try {
            const data = await api.get(`/brands/${brandId}/market-profiles`);
            setProfiles(data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = () => {
        setEditing({ ...DEFAULT_PROFILE });
        setIsNew(true);
        setError(null);
    };

    const handleEdit = (profile: MarketProfile) => {
        setEditing({ ...profile });
        setIsNew(false);
        setError(null);
    };

    const handleCancel = () => {
        setEditing(null);
        setIsNew(false);
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!brandId || !editing) return;
        setSaving(true);
        setError(null);

        try {
            if (isNew) {
                await api.post(`/brands/${brandId}/market-profiles`, editing);
            } else {
                await api.patch(`/market-profiles/${editing.id}`, editing);
            }
            setEditing(null);
            loadProfiles();
        } catch (err: any) {
            console.error(err);
            setError(err.error || "Failed to save profile");
        } finally {
            setSaving(false);
        }
    };

    const handleActivate = async (id: string) => {
        if (!confirm("Activate this profile? Any other active profile will be deactivated.")) return;
        try {
            await api.post(`/market-profiles/${id}/activate`, {});
            loadProfiles();
        } catch (err: any) {
            alert(err.error || "Failed to activate");
        }
    };

    // Helper for Array Inputs (comma separated for MVP)
    const handleArrayInput = (field: keyof MarketProfile, value: string) => {
        if (!editing) return;
        // Split by comma, trim, filter empty
        const arr = value.split(',').map(s => s.trim()).filter(s => s.length > 0);
        setEditing({ ...editing, [field]: arr });
    };

    const getArrayString = (field: keyof MarketProfile) => {
        const val = editing?.[field];
        if (Array.isArray(val)) return val.join(', ');
        return '';
    };

    if (loading && !profiles.length) return <div className="p-8">Loading Market Profiles...</div>;

    // EDITOR VIEW
    if (editing) {
        return (
            <div className="p-6 max-w-4xl mx-auto bg-white shadow rounded">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-2xl font-bold">{isNew ? 'Create Market Profile' : 'Edit Profile'}</h2>
                    <button onClick={handleCancel} className="text-gray-500 hover:text-black">Cancel</button>
                </div>

                {error && (
                    <div className="mb-4 p-4 bg-red-100 border border-red-200 text-red-700 rounded-md">
                        <strong className="block font-bold">Error Saving Profile:</strong>
                        {error}
                        {editing.validation_warnings && editing.validation_warnings.length > 0 && (
                            <ul className="mt-2 list-disc list-inside text-sm">
                                {editing.validation_warnings.map(w => <li key={w}>{w}</li>)}
                            </ul>
                        )}
                    </div>
                )}

                {editing.validation_warnings && editing.validation_warnings.length > 0 && !error && (
                    <div className="mb-4 p-4 bg-yellow-100 border border-yellow-200 text-yellow-800 rounded-md">
                        <strong className="block font-bold">Validation Warnings (Draft Mode):</strong>
                        <ul className="mt-1 list-disc list-inside text-sm">
                            {editing.validation_warnings.map(w => <li key={w}>{w}</li>)}
                        </ul>
                    </div>
                )}

                <form onSubmit={handleSave} className="space-y-6">
                    {/* Basics */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium mb-1">Profile Name</label>
                            <input className="w-full p-2 border rounded"
                                value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} required />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Primary Category</label>
                            <select className="w-full p-2 border rounded"
                                value={editing.primary_category} onChange={e => setEditing({ ...editing, primary_category: e.target.value })}>
                                {MARKET_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-1">Target Audience (Description)</label>
                        <textarea className="w-full p-2 border rounded h-20"
                            value={editing.target_audience} onChange={e => setEditing({ ...editing, target_audience: e.target.value })}
                            placeholder="e.g. Women 25-34 interested in organic skincare..." required />
                    </div>

                    {/* Keywords Section */}
                    <div className="p-4 bg-gray-50 rounded border">
                        <h3 className="font-bold mb-3 text-gray-700">Targeting Signals</h3>

                        <div className="mb-4">
                            <label className="block text-sm font-medium mb-1">Positive Keywords (Comma separated)</label>
                            <span className="text-xs text-gray-500 block mb-1">Phrases to match in captions/bio. Min 3 required.</span>
                            <input className="w-full p-2 border rounded"
                                value={getArrayString('keywords_positive')}
                                onChange={e => handleArrayInput('keywords_positive', e.target.value)}
                                placeholder="organic, vitamin c, glow, skin routine" />
                        </div>

                        <div className="mb-4">
                            <label className="block text-sm font-medium mb-1">Negative Keywords (Safety)</label>
                            <span className="text-xs text-gray-500 block mb-1">Phrases to strictly avoid. Min 1 required.</span>
                            <input className="w-full p-2 border rounded"
                                value={getArrayString('keywords_negative')}
                                onChange={e => handleArrayInput('keywords_negative', e.target.value)}
                                placeholder="cheap, scam, chemical, giveaway" />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-1">Positive Hashtags</label>
                                <input className="w-full p-2 border rounded"
                                    value={getArrayString('hashtags_positive')}
                                    onChange={e => handleArrayInput('hashtags_positive', e.target.value)}
                                    placeholder="#skincare, #beauty" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1">Negative Hashtags</label>
                                <input className="w-full p-2 border rounded"
                                    value={getArrayString('hashtags_negative')}
                                    onChange={e => handleArrayInput('hashtags_negative', e.target.value)}
                                    placeholder="#ad, #sponsored" />
                            </div>
                        </div>
                    </div>

                    {/* Strategy */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium mb-1">Discovery Intent</label>
                            <select className="w-full p-2 border rounded"
                                value={editing.discovery_intent} onChange={e => setEditing({ ...editing, discovery_intent: e.target.value })}>
                                {DISCOVERY_INTENTS.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <span className="text-xs text-gray-500">
                                {editing.discovery_intent === 'CONSERVATIVE' && "High threshold (0.8), safer matches."}
                                {editing.discovery_intent === 'BALANCED' && "Medium threshold (0.6), balanced volume."}
                                {editing.discovery_intent === 'AGGRESSIVE' && "Low threshold (0.4), max volume."}
                            </span>
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Quality Score Estimate</label>
                            <div className="text-2xl font-bold text-gray-400">
                                {editing.quality_score ? (editing.quality_score * 100).toFixed(0) : '--'}%
                            </div>
                        </div>
                    </div>

                    {/* Weights (Advanced) - Collapsed or simpler? Let's just show inputs */}
                    <div className="p-4 bg-gray-50 border rounded">
                        <h3 className="font-bold text-sm mb-3 text-gray-700">Scoring Weights (Sum ≤ 1.0)</h3>
                        <div className="flex gap-4">
                            <div className="flex-1">
                                <label className="block text-xs font-bold mb-1">Keyword Weight ({editing.weight_keyword})</label>
                                <input type="range" min="0" max="1" step="0.1" className="w-full"
                                    value={editing.weight_keyword}
                                    onChange={e => setEditing({ ...editing, weight_keyword: parseFloat(e.target.value) })} />
                            </div>
                            <div className="flex-1">
                                <label className="block text-xs font-bold mb-1">Hashtag Weight ({editing.weight_hashtag})</label>
                                <input type="range" min="0" max="1" step="0.1" className="w-full"
                                    value={editing.weight_hashtag}
                                    onChange={e => setEditing({ ...editing, weight_hashtag: parseFloat(e.target.value) })} />
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-4 border-t">
                        <button type="button" onClick={handleCancel} className="px-4 py-2 text-gray-600">Cancel</button>
                        <button type="submit" disabled={saving} className="px-6 py-2 bg-blue-600 text-white rounded font-bold hover:bg-blue-700 disabled:opacity-50">
                            {saving ? 'Saving...' : 'Save Profile'}
                        </button>
                    </div>
                </form>
            </div>
        );
    }

    // LIST VIEW
    return (
        <div className="p-8">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h1 className="text-3xl font-bold">Market Intelligence</h1>
                    <p className="text-gray-500">Manage targeting profiles for discovery.</p>
                </div>
                <button
                    onClick={handleCreate}
                    className="px-4 py-2 bg-black text-white rounded hover:bg-gray-800"
                >
                    New Profile
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                {profiles.map(p => (
                    <div key={p.id}
                        className={`bg-white rounded-lg shadow border relative overflow-hidden cursor-pointer hover:shadow-md transition-shadow
                             ${p.is_active ? 'border-green-500 ring-1 ring-green-500' : 'border-gray-200'}`}
                        onClick={() => handleEdit(p)}
                    >
                        {p.is_active && (
                            <div className="absolute top-0 right-0 bg-green-500 text-white text-xs px-2 py-1 rounded-bl font-bold">
                                ACTIVE
                            </div>
                        )}
                        <div className="p-5">
                            <div className="flex justify-between items-start mb-2">
                                <h3 className="font-bold text-lg truncate pr-8">{p.name}</h3>
                            </div>

                            <div className="flex flex-wrap gap-2 mb-4">
                                <span className={`text-xs px-2 py-1 rounded font-mono ${p.status === 'READY' || p.status === 'ACTIVE' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                                    {p.status} (v{p.version})
                                </span>
                                <span className="text-xs px-2 py-1 rounded bg-purple-50 text-purple-700 font-bold">
                                    {p.primary_category}
                                </span>
                            </div>

                            <p className="text-sm text-gray-600 mb-4 line-clamp-2 min-h-[40px]">
                                {p.target_audience}
                            </p>

                            <div className="text-xs text-gray-500 space-y-1">
                                <div className="flex justify-between">
                                    <span>Keywords:</span>
                                    <span className="font-mono text-black">{p.keywords_positive.length} pos / {p.keywords_negative.length} neg</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Intent:</span>
                                    <span className="font-bold text-black">{p.discovery_intent}</span>
                                </div>
                                <div className="flex justify-between pt-2 border-t mt-2">
                                    <span>Quality Score:</span>
                                    <span className={`font-bold ${p.quality_score > 0.8 ? 'text-green-600' : p.quality_score < 0.5 ? 'text-red-600' : 'text-yellow-600'}`}>
                                        {(p.quality_score * 100).toFixed(0)}%
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Footer Actions */}
                        <div className="bg-gray-50 px-5 py-3 border-t flex justify-end gap-2" onClick={e => e.stopPropagation()}>
                            {!p.is_active && (p.status === 'READY' || p.status === 'ACTIVE') && (
                                <button
                                    onClick={() => handleActivate(p.id)}
                                    className="text-xs font-bold text-green-600 hover:text-green-800 uppercase"
                                >
                                    Activate
                                </button>
                            )}
                            <button onClick={() => handleEdit(p)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                                Edit
                            </button>
                        </div>
                    </div>
                ))}
            </div>
            {!loading && profiles.length === 0 && (
                <div className="text-center p-12 bg-white rounded border border-dashed">
                    <p className="text-gray-500 mb-4">No market profiles defined yet.</p>
                    <button onClick={handleCreate} className="text-blue-600 font-bold hover:underline">Create your first profile</button>
                </div>
            )}
        </div>
    );
};
