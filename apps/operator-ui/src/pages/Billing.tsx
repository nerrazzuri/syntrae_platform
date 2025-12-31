import { useState, useEffect } from 'react';
import { api } from '../lib/api';

interface PlanInfo {
    plan_id: 'FREE' | 'PRO';
    status: string;
}

export function BillingPage() {
    const [planInfo, setPlanInfo] = useState<PlanInfo | null>(null);
    const [brands, setBrands] = useState<any[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [resolveMode, setResolveMode] = useState(false);
    const [selectedBrand, setSelectedBrand] = useState<string | null>(null);

    const fetchInfo = async () => {
        try {
            const me = await api.get('/auth/me');
            if (me.active_workspace) {
                setPlanInfo({
                    plan_id: me.active_workspace.plan_id,
                    status: me.active_workspace.status
                });

                if (me.active_workspace.status === 'PENDING_DOWNGRADE') {
                    setResolveMode(true);
                    const b = await api.get('/brands');
                    setBrands(b);
                }
            }
        } catch (e) {
            console.error(e);
        }
    };

    useEffect(() => {
        fetchInfo();
    }, []);

    const handleUpgrade = async () => {
        try {
            const res = await api.post('/billing/upgrade', {});
            if (res.status === 'success') {
                alert('Upgraded to PRO!');
                window.location.reload();
            }
        } catch (e: any) {
            setError(e.message || 'Upgrade failed');
        }
    };

    const handleDowngrade = async () => {
        if (!confirm('Are you sure? This will restrict you to 1 active Brand.')) return;
        try {
            const res = await api.post('/billing/downgrade', {});
            if (res.status === 'success') {
                if (res.account_status === 'PENDING_DOWNGRADE') {
                    const b = await api.get('/brands');
                    setBrands(b);
                    setResolveMode(true);
                } else {
                    alert('Downgraded to FREE.');
                    window.location.reload();
                }
            }
        } catch (e: any) {
            setError(e.message || 'Downgrade failed');
        }
    };

    const handleResolve = async () => {
        if (!selectedBrand) return;
        try {
            const res = await api.post('/billing/resolve-downgrade', { keep_brand_id: selectedBrand });
            if (res.status === 'success') {
                alert('Downgrade resolved.');
                window.location.reload();
            }
        } catch (e: any) {
            setError(e.message || 'Resolution failed');
        }
    };

    if (!planInfo) return <div>Loading...</div>;

    if (resolveMode) {
        return (
            <div className="p-8 max-w-2xl mx-auto">
                <h1 className="text-2xl font-bold text-red-600 mb-4">Action Required: Select Primary Brand</h1>
                <p className="mb-6 text-gray-700">
                    You are downgrading to the FREE plan, which supports only <b>1 Active Brand</b>.
                    Please select the Brand you wish to keep active. All others will be paused (activatable if you upgrade again).
                </p>

                <div className="space-y-4 mb-6">
                    {brands.map(b => (
                        <div
                            key={b.id}
                            onClick={() => setSelectedBrand(b.id)}
                            className={`p-4 border rounded cursor-pointer flex justify-between items-center ${selectedBrand === b.id ? 'border-primary ring-2 ring-primary bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                                }`}
                        >
                            <span className="font-semibold">{b.name}</span>
                            <span className="text-sm text-gray-500">{b.domain}</span>
                        </div>
                    ))}
                </div>

                <button
                    onClick={handleResolve}
                    disabled={!selectedBrand}
                    className="w-full py-3 bg-red-600 text-white font-bold rounded disabled:opacity-50"
                >
                    Confirm Selection & Complete Downgrade
                </button>
                {error && <div className="mt-4 text-red-500">{error}</div>}
            </div>
        );
    }

    return (
        <div className="p-8">
            <h1 className="text-3xl font-bold mb-6">Billing & Plans</h1>

            <div className="bg-white p-6 rounded shadow max-w-xl">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h2 className="text-xl font-semibold">Current Plan</h2>
                        <p className="text-gray-500">{planInfo.plan_id === 'FREE' ? 'Free Tier' : 'Pro Tier'}</p>
                    </div>
                    <span className={`px-3 py-1 rounded text-sm font-bold ${planInfo.plan_id === 'PRO' ? 'bg-indigo-100 text-indigo-800' : 'bg-gray-100 text-gray-800'
                        }`}>
                        {planInfo.plan_id}
                    </span>
                </div>

                <div className="border-t pt-6">
                    {planInfo.plan_id === 'FREE' ? (
                        <div>
                            <h3 className="font-semibold mb-2">Upgrade to Pro</h3>
                            <ul className="list-disc list-inside mb-4 text-gray-600 text-sm">
                                <li>Manage up to 5 Brands</li>
                                <li>Automated DM Drafting</li>
                                <li>Priority Support</li>
                            </ul>
                            <button
                                onClick={handleUpgrade}
                                className="w-full py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 font-medium"
                            >
                                Upgrade to Pro
                            </button>
                        </div>
                    ) : (
                        <div>
                            <h3 className="font-semibold mb-2">Manage Subscription</h3>
                            <p className="text-sm text-gray-600 mb-4">You are currently on the Pro plan.</p>
                            <button
                                onClick={handleDowngrade}
                                className="text-red-600 text-sm hover:underline"
                            >
                                Downgrade to Free
                            </button>
                        </div>
                    )}
                </div>
            </div>
            {error && <div className="mt-4 text-red-500">{error}</div>}
        </div>
    );
}
