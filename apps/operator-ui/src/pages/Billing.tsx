import { useEffect, useState } from 'react';
import { api } from '../lib/api';

type PlanCode = 'STARTER' | 'GROWTH' | 'PRO' | 'AGENCY';
type BillingInterval = 'MONTHLY' | 'YEARLY';

interface SubscriptionSummary {
    plan_code: PlanCode;
    display_name: string;
    subscription_status: string;
    billing_interval: BillingInterval;
    billing: {
        provider: string;
        stripe_configured: boolean;
        customer_linked: boolean;
        subscription_linked: boolean;
        portal_available: boolean;
        manual_change_allowed: boolean;
    };
    plan_options: Array<{
        plan_code: PlanCode;
        display_name: string;
        billing_intervals: BillingInterval[];
        checkout_enabled: boolean;
    }>;
    features: Record<string, boolean>;
    usage: {
        active_brands: { used: number; limit: number };
        team_members: { used: number; limit: number };
        automation_runs_daily: { used: number; limit: number };
    };
    blocked: Array<{ code: string; message: string }>;
}

const PLAN_ORDER: PlanCode[] = ['STARTER', 'GROWTH', 'PRO', 'AGENCY'];

const PLAN_COPY: Record<PlanCode, string> = {
    STARTER: 'Manual, single-brand starter package.',
    GROWTH: 'Higher volume with scoring, drafts, and exports.',
    PRO: 'Rule-ready automation for up to 3 brands, each with its own active market strategy.',
    AGENCY: 'Multi-brand, team-aware package for client isolation.',
};

export function BillingPage() {
    const [summary, setSummary] = useState<SubscriptionSummary | null>(null);
    const [brands, setBrands] = useState<any[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
    const [billingInterval, setBillingInterval] = useState<BillingInterval>('MONTHLY');
    const [loadingAction, setLoadingAction] = useState<string | null>(null);

    const loadSummary = async () => {
        try {
            const data = await api.get('/billing/subscription');
            setSummary(data);
            setBillingInterval(data.billing_interval || 'MONTHLY');
        } catch (e: any) {
            setError(e.message || 'Failed to load subscription');
        }
    };

    useEffect(() => {
        loadSummary();
    }, []);

    const handleCheckout = async (planCode: PlanCode) => {
        try {
            setLoadingAction(planCode);
            const res = await api.post('/billing/checkout-session', {
                plan_code: planCode,
                billing_interval: billingInterval,
            });
            if (res.url) {
                window.location.href = res.url;
                return;
            }
        } catch (e: any) {
            setError(e.message || 'Checkout failed');
        } finally {
            setLoadingAction(null);
        }
    };

    const handleDowngrade = async () => {
        try {
            setLoadingAction('STARTER');
            if (summary?.billing.portal_available) {
                const res = await api.post('/billing/portal-session', {});
                if (res.url) {
                    window.location.href = res.url;
                    return;
                }
            }
            const res = await api.post('/billing/downgrade', {});
            if (res.account_status === 'PENDING_DOWNGRADE') {
                const b = await api.get('/brands');
                setBrands(b);
                return;
            }
            await loadSummary();
        } catch (e: any) {
            setError(e.message || 'Downgrade failed');
        } finally {
            setLoadingAction(null);
        }
    };

    const handleResolveDowngrade = async () => {
        if (!selectedBrand) return;
        try {
            setLoadingAction('resolve-downgrade');
            await api.post('/billing/resolve-downgrade', { keep_brand_id: selectedBrand });
            setBrands([]);
            setSelectedBrand(null);
            await loadSummary();
        } catch (e: any) {
            setError(e.message || 'Resolution failed');
        } finally {
            setLoadingAction(null);
        }
    };

    const handlePortal = async () => {
        try {
            setLoadingAction('portal');
            const res = await api.post('/billing/portal-session', {});
            if (res.url) {
                window.location.href = res.url;
            }
        } catch (e: any) {
            setError(e.message || 'Unable to open billing portal');
        } finally {
            setLoadingAction(null);
        }
    };

    if (!summary) return <div className="p-8">Loading subscription...</div>;

    if (brands.length > 0) {
        return (
            <div className="p-8 max-w-2xl mx-auto">
                <h1 className="text-2xl font-bold text-red-600 mb-4">Select The Brand To Keep Active</h1>
                <p className="mb-6 text-gray-700">
                    Moving to Starter requires a single active brand. All others will remain paused until you upgrade again.
                </p>
                <div className="space-y-4 mb-6">
                    {brands.map((brand) => (
                        <div
                            key={brand.id}
                            onClick={() => setSelectedBrand(brand.id)}
                            className={`p-4 border rounded cursor-pointer flex justify-between items-center ${selectedBrand === brand.id ? 'border-primary ring-2 ring-primary bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}`}
                        >
                            <span className="font-semibold">{brand.name}</span>
                            <span className="text-sm text-gray-500">{brand.domain}</span>
                        </div>
                    ))}
                </div>
                <button
                    onClick={handleResolveDowngrade}
                    disabled={!selectedBrand || loadingAction === 'resolve-downgrade'}
                    className="w-full py-3 bg-red-600 text-white font-bold rounded disabled:opacity-50"
                >
                    {loadingAction === 'resolve-downgrade' ? 'Applying...' : 'Confirm Starter Downgrade'}
                </button>
                {error && <div className="mt-4 text-red-500">{error}</div>}
            </div>
        );
    }

    return (
        <div className="space-y-6 p-8">
            <div className="bg-white p-6 rounded shadow">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h1 className="text-3xl font-bold">Subscription</h1>
                        <p className="text-gray-500">{summary.display_name}</p>
                    </div>
                    <div className="flex items-center gap-3">
                        {summary.billing.portal_available && (
                            <button
                                onClick={handlePortal}
                                disabled={loadingAction === 'portal'}
                                className="px-3 py-2 rounded border border-gray-300 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
                            >
                                {loadingAction === 'portal' ? 'Opening...' : 'Manage Billing'}
                            </button>
                        )}
                        <span className="px-3 py-1 rounded text-sm font-bold bg-indigo-100 text-indigo-800">
                            {summary.plan_code}
                        </span>
                    </div>
                </div>
                <p className="text-sm text-gray-600">
                    Status: {summary.subscription_status} · Interval: {summary.billing_interval.toLowerCase()}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6 text-sm">
                    <div className="rounded border p-4">
                        <div className="text-gray-500">Active Brands</div>
                        <div className="text-xl font-bold">{summary.usage.active_brands.used} / {summary.usage.active_brands.limit}</div>
                    </div>
                    <div className="rounded border p-4">
                        <div className="text-gray-500">Team Members</div>
                        <div className="text-xl font-bold">{summary.usage.team_members.used} / {summary.usage.team_members.limit}</div>
                    </div>
                    <div className="rounded border p-4">
                        <div className="text-gray-500">Automation Runs Today</div>
                        <div className="text-xl font-bold">{summary.usage.automation_runs_daily.used} / {summary.usage.automation_runs_daily.limit}</div>
                    </div>
                </div>
            </div>

            <div className="bg-white p-6 rounded shadow">
                <div className="flex items-center justify-between gap-4 mb-4">
                    <h2 className="text-xl font-semibold">Packages</h2>
                    <div className="inline-flex rounded border border-gray-200 p-1 text-sm">
                        {(['MONTHLY', 'YEARLY'] as BillingInterval[]).map((interval) => (
                            <button
                                key={interval}
                                onClick={() => setBillingInterval(interval)}
                                className={`px-3 py-1 rounded ${billingInterval === interval ? 'bg-indigo-600 text-white' : 'text-gray-600'}`}
                            >
                                {interval === 'MONTHLY' ? 'Monthly' : 'Yearly'}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="space-y-4">
                    {PLAN_ORDER.map((planCode) => {
                        const isCurrent = summary.plan_code === planCode;
                        const option = summary.plan_options.find((entry) => entry.plan_code === planCode);
                        const supportsInterval = option?.billing_intervals.includes(billingInterval) ?? false;
                        const canCheckout = Boolean(option?.checkout_enabled && supportsInterval && planCode !== 'STARTER');
                        return (
                            <div key={planCode} className={`border rounded p-4 ${isCurrent ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200'}`}>
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h3 className="font-semibold">{planCode}</h3>
                                        <p className="text-sm text-gray-600">{PLAN_COPY[planCode]}</p>
                                        {option && (
                                            <p className="text-xs text-gray-500 mt-2">
                                                {option.billing_intervals.map((interval) => interval.toLowerCase()).join(' / ')}
                                            </p>
                                        )}
                                    </div>
                                    {isCurrent ? (
                                        <span className="text-sm font-semibold text-indigo-700">Current</span>
                                    ) : planCode === 'STARTER' ? (
                                        <button
                                            onClick={handleDowngrade}
                                            disabled={loadingAction === 'STARTER'}
                                            className="text-sm text-red-600 hover:underline disabled:opacity-50"
                                        >
                                            {loadingAction === 'STARTER' ? 'Opening...' : (summary.billing.portal_available ? 'Manage downgrade' : 'Move to Starter')}
                                        </button>
                                    ) : canCheckout ? (
                                        <button
                                            onClick={() => handleCheckout(planCode)}
                                            disabled={loadingAction === planCode}
                                            className="px-3 py-2 rounded bg-indigo-600 text-white text-sm font-medium disabled:opacity-50"
                                        >
                                            {loadingAction === planCode ? 'Redirecting...' : `Checkout ${billingInterval === 'MONTHLY' ? 'Monthly' : 'Yearly'}`}
                                        </button>
                                    ) : summary.billing.manual_change_allowed ? (
                                        <button
                                            onClick={async () => {
                                                try {
                                                    setLoadingAction(planCode);
                                                    const res = await api.post('/billing/change-plan', { plan_code: planCode });
                                                    if (res.status === 'success') await loadSummary();
                                                } catch (e: any) {
                                                    setError(e.message || 'Plan update failed');
                                                } finally {
                                                    setLoadingAction(null);
                                                }
                                            }}
                                            disabled={loadingAction === planCode}
                                            className="px-3 py-2 rounded bg-indigo-600 text-white text-sm font-medium disabled:opacity-50"
                                        >
                                            {loadingAction === planCode ? 'Switching...' : 'Switch'}
                                        </button>
                                    ) : (
                                        <span className="text-sm text-gray-400">Unavailable</span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="bg-white p-6 rounded shadow">
                <h2 className="text-xl font-semibold mb-4">Feature Access</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    {Object.entries(summary.features).map(([feature, enabled]) => (
                        <div key={feature} className="flex items-center justify-between rounded border px-3 py-2">
                            <span className="capitalize">{feature.replace(/([A-Z])/g, ' $1').trim()}</span>
                            <span className={enabled ? 'text-emerald-600 font-semibold' : 'text-gray-400 font-semibold'}>
                                {enabled ? 'Enabled' : 'Locked'}
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            {summary.blocked.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded p-6">
                    <h2 className="text-lg font-semibold text-amber-800 mb-3">Upgrade Prompts</h2>
                    <div className="space-y-2 text-sm text-amber-900">
                        {summary.blocked.map((item) => (
                            <div key={item.code}>{item.message}</div>
                        ))}
                    </div>
                </div>
            )}

            <div className="bg-white p-6 rounded shadow">
                <h2 className="text-xl font-semibold mb-4">Billing Backend</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <div className="rounded border px-3 py-2 flex items-center justify-between">
                        <span>Provider</span>
                        <span className="font-semibold">{summary.billing.provider}</span>
                    </div>
                    <div className="rounded border px-3 py-2 flex items-center justify-between">
                        <span>Stripe Configured</span>
                        <span className={summary.billing.stripe_configured ? 'text-emerald-600 font-semibold' : 'text-gray-400 font-semibold'}>
                            {summary.billing.stripe_configured ? 'Yes' : 'No'}
                        </span>
                    </div>
                </div>
            </div>

            {error && <div className="text-red-500">{error}</div>}
        </div>
    );
}
