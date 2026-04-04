import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

export function BrandsPage() {
    const [brands, setBrands] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);

    // Create Form
    const [newName, setNewName] = useState('');
    const [newDomain, setNewDomain] = useState('');
    const [error, setError] = useState<string | null>(null);

    const loadBrands = async () => {
        try {
            const data = await api.get('/brands');
            setBrands(data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadBrands(); }, []);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        try {
            await api.post('/brands', { name: newName, domain: newDomain });
            setShowCreate(false);
            setNewName('');
            setNewDomain('');
            loadBrands();
        } catch (e: any) {
            setError(e.error || 'Failed to create brand');
        }
    };

    const toggleStatus = async (brandId: string, currentStatus: string) => {
        const newStatus = currentStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
        try {
            await api.patch(`/brands/${brandId}/status`, { status: newStatus });
            loadBrands();
        } catch (e: any) {
            alert(e.error || 'Failed to update status');
        }
    };

    return (
        <div className="p-8">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-3xl font-bold">Brands</h1>
                <button
                    onClick={() => setShowCreate(!showCreate)}
                    className="px-4 py-2 bg-black text-white rounded hover:bg-gray-800"
                >
                    {showCreate ? 'Cancel' : 'Add Brand'}
                </button>
            </div>

            {error && <div className="mb-4 p-3 bg-red-100 text-red-700 rounded">{error}</div>}

            {showCreate && (
                <form onSubmit={handleCreate} className="mb-8 p-6 bg-gray-50 rounded border">
                    <h3 className="font-bold mb-4">New Brand</h3>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className="block text-sm font-medium mb-1">Brand Name</label>
                            <input
                                className="w-full p-2 border rounded"
                                value={newName} onChange={e => setNewName(e.target.value)}
                                placeholder="Acme Corp"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium mb-1">Domain</label>
                            <input
                                className="w-full p-2 border rounded"
                                value={newDomain} onChange={e => setNewDomain(e.target.value)}
                                placeholder="acme.com"
                                required
                            />
                        </div>
                    </div>
                    <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded">Create Brand</button>
                </form>
            )}

            {/* PILOT: Discovery Behavior Explanation */}
            <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h3 className="text-sm font-semibold text-blue-900 mb-2">How Video Discovery Works (Pilot)</h3>
                <p className="text-sm text-blue-800 leading-relaxed">
                    Discovery uses keyword-based search to find relevant videos per run. Each run processes <strong>a limited set of videos</strong> from the first page of search results
                    (typically 10-30 videos). The system does not continuously scroll or attempt to find every video on the platform.
                    This bounded behavior is intentional to ensure platform safety and compliance with rate limits during the pilot.
                </p>
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
                {brands.map(brand => (
                    <div key={brand.id} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition-shadow hover:shadow-md">
                        <div className="flex flex-col gap-6">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h3 className="text-xl font-bold text-slate-900">{brand.name}</h3>
                                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${brand.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                                            }`}>
                                            {brand.status}
                                        </span>
                                    </div>
                                    <p className="mt-2 text-sm text-slate-500">{brand.domain}</p>
                                </div>
                                <button
                                    onClick={() => toggleStatus(brand.id, brand.status)}
                                    className="inline-flex items-center justify-center rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
                                >
                                    {brand.status === 'ACTIVE' ? 'Pause Brand' : 'Resume Brand'}
                                </button>
                            </div>

                            <div className="rounded-2xl border border-rose-100 bg-gradient-to-r from-rose-50 via-white to-orange-50 p-4">
                                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                    <div>
                                        <div className="text-xs font-semibold uppercase tracking-[0.24em] text-rose-700">Primary Run Action</div>
                                        <div className="mt-2 text-base font-semibold text-slate-900">Run Xiaohongshu discovery</div>
                                        <p className="mt-1 text-sm text-slate-600">
                                            Queue a live XHS discovery run for this brand using the connected session and current market profile.
                                        </p>
                                    </div>
                                    <button
                                        onClick={async () => {
                                            if (confirm('Queue a Xiaohongshu Discovery Run?')) {
                                                await api.post(`/brands/${brand.id}/runs/queue`, { platform: 'xiaohongshu' });
                                                alert('Xiaohongshu Run Queued! Watch your agent console.');
                                            }
                                        }}
                                        className="inline-flex min-w-[180px] items-center justify-center rounded-full bg-rose-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-rose-700"
                                    >
                                        Run XHS Discovery
                                    </button>
                                </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-3">
                                <Link
                                    to={`/brands/${brand.id}/policy`}
                                    className="inline-flex items-center justify-center rounded-full border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700 transition hover:bg-blue-100"
                                >
                                    Automation Policy
                                </Link>
                                <Link
                                    to={`/brands/${brand.id}/connections`}
                                    className="inline-flex items-center justify-center rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-100"
                                >
                                    Connect XHS
                                </Link>
                                <Link
                                    to={`/brands/${brand.id}/market-profiles`}
                                    className="inline-flex items-center justify-center rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                                >
                                    Market Strategy
                                </Link>
                            </div>
                        </div>
                    </div>
                ))}
                {!loading && brands.length === 0 && (
                    <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500 lg:col-span-2">No brands found.</div>
                )}
            </div>
        </div >
    );
}
