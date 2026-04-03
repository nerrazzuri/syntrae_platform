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

            <div className="bg-white rounded shadow divide-y">
                {brands.map(brand => (
                    <div key={brand.id} className="p-4 flex justify-between items-center">
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="font-bold text-lg">{brand.name}</h3>
                                <span className={`text-xs px-2 py-0.5 rounded ${brand.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                                    }`}>
                                    {brand.status}
                                </span>
                            </div>
                            <p className="text-gray-500 text-sm">{brand.domain}</p>
                        </div>
                        <div className="flex items-center gap-4">
                            <button
                                onClick={() => toggleStatus(brand.id, brand.status)}
                                className="text-sm underline text-gray-600 hover:text-black"
                            >
                                {brand.status === 'ACTIVE' ? 'Pause' : 'Resume'}
                            </button>
                            <button
                                onClick={async () => {
                                    if (confirm('Queue a TikTok Discovery Run?')) {
                                        await api.post(`/brands/${brand.id}/runs/queue`, { platform: 'tiktok' });
                                        alert('TikTok Run Queued! Watch your agent console.');
                                    }
                                }}
                                className="text-sm font-medium text-green-600 hover:text-green-800 underline"
                            >
                                Run TikTok
                            </button>
                            <button
                                onClick={async () => {
                                    if (confirm('Queue a Xiaohongshu Discovery Run?')) {
                                        await api.post(`/brands/${brand.id}/runs/queue`, { platform: 'xiaohongshu' });
                                        alert('Xiaohongshu Run Queued! Watch your agent console.');
                                    }
                                }}
                                className="text-sm font-medium text-red-600 hover:text-red-800 underline"
                            >
                                Run XHS
                            </button>
                            <Link
                                to={`/brands/${brand.id}/policy`}
                                className="text-sm font-medium text-blue-600 hover:text-blue-800"
                            >
                                Automation Policy
                            </Link>
                            <Link
                                to={`/brands/${brand.id}/market-profiles`}
                                className="text-xs px-3 py-1 bg-purple-600 text-white rounded hover:bg-purple-700 font-bold uppercase tracking-wide"
                            >
                                Market Strategy
                            </Link>
                        </div>
                    </div>
                ))}
                {!loading && brands.length === 0 && (
                    <div className="p-8 text-center text-gray-500">No brands found.</div>
                )}
            </div>
        </div >
    );
}
