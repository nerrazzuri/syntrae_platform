import { useEffect, useState } from 'react';
import { api } from '../lib/api';

type PlanCode = 'BASIC' | 'STARTER' | 'GROWTH' | 'PRO' | 'AGENCY';
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
    lead_quota: {
        used: number;
        included: number;
        rollover: number;
        extra: number;
        limit: number;
        remaining: number;
        auto_extension_enabled: boolean;
        warning_threshold: number;
        warning_reached: boolean;
        next_reset_at: string;
        overage_block_size: number;
        overage_block_price_minor: number;
        overage_currency: string;
        overage_blocks_purchased: number;
        last_auto_charge_at: string | null;
        last_invoice_id: string | null;
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
        automation_runs_daily: { used: number; limit: number | null };
        leads_captured_monthly: { used: number; limit: number };
    };
    blocked: Array<{ code: string; message: string }>;
}

interface UsageSnapshot {
    leads_captured_month: number;
    leads_rollover_month: number;
    leads_captured_limit: number;
    leads_captured_remaining: number;
    high_intent_leads_month: number;
    converted_leads_month: number;
    estimated_revenue_month: number;
    automation_runs_daily_used: number;
    automation_runs_daily_limit: number | null;
    lead_auto_extension_enabled: boolean;
    lead_warning_threshold: number;
    lead_warning_reached: boolean;
    lead_overage_block_size: number;
    lead_overage_block_price_minor: number;
    lead_overage_currency: string;
    lead_next_reset_at: string;
    features: Record<string, boolean>;
}

const PLAN_ORDER: PlanCode[] = ['BASIC', 'STARTER', 'GROWTH', 'PRO', 'AGENCY'];

const PLAN_COPY: Record<PlanCode, string> = {
    BASIC: 'Free tier with 1 brand and a small monthly lead allowance for initial testing.',
    STARTER: 'RM49/month with 50 monthly leads for single-brand manual review and basic comment-to-lead workflow.',
    GROWTH: 'RM199/month with 400 monthly leads, exports, scoring, and assisted drafting.',
    PRO: 'RM399/month with 1000 monthly leads, multi-brand operations, and automation-ready workflows.',
    AGENCY: 'High-volume multi-client operations with expanded lead capacity and team control.',
};

const PLAN_PRICES: Partial<Record<PlanCode, string>> = {
    STARTER: 'RM49 / month',
    GROWTH: 'RM199 / month',
    PRO: 'RM399 / month',
};

export function BillingPage() {
    const [summary, setSummary] = useState<SubscriptionSummary | null>(null);
    const [usage, setUsage] = useState<UsageSnapshot | null>(null);
    const [brands, setBrands] = useState<any[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
    const [billingInterval, setBillingInterval] = useState<BillingInterval>('MONTHLY');
    const [voucherCode, setVoucherCode] = useState('');
    const [loadingAction, setLoadingAction] = useState<string | null>(null);
    const [selectedIntervals, setSelectedIntervals] = useState<Partial<Record<PlanCode, BillingInterval>>>({});

    const loadSummary = async () => {
        try {
            const [data, usageData] = await Promise.all([
                api.get('/billing/subscription') as Promise<SubscriptionSummary>,
                api.analytics.getUsage() as Promise<UsageSnapshot>,
            ]);
            setSummary(data);
            setUsage(usageData);
            setBillingInterval(data.billing_interval || 'MONTHLY');
            setSelectedIntervals(() => {
                const next: Partial<Record<PlanCode, BillingInterval>> = {};
                data.plan_options.forEach((option) => {
                    if (!option.billing_intervals.length) return;
                    next[option.plan_code] = option.billing_intervals.includes(data.billing_interval)
                        ? data.billing_interval
                        : option.billing_intervals[0];
                });
                return next;
            });
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
            setError(null);
            setNotice(null);
            const interval = selectedIntervals[planCode] || billingInterval;
            const res = await api.post('/billing/checkout-session', {
                plan_code: planCode,
                billing_interval: interval,
                voucher_code: voucherCode,
            });
            if (res.applied_voucher?.code) {
                setNotice(`Voucher ${res.applied_voucher.code} applied. Stripe checkout will start with ${res.applied_voucher.duration_days} free days.`);
            }
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
            setLoadingAction('BASIC');
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

    const handleLeadBlockCheckout = async () => {
        try {
            setLoadingAction('lead-block');
            setError(null);
            setNotice(null);
            const res = await api.post('/billing/lead-block-checkout-session', { quantity: 1 });
            if (res.url) {
                window.location.href = res.url;
            }
        } catch (e: any) {
            setError(e.message || 'Unable to start lead block checkout');
        } finally {
            setLoadingAction(null);
        }
    };

    if (!summary) return <div className="p-8">Loading subscription...</div>;

    const upgradePrompts = usage ? [
        !usage.features.exportEnabled && usage.high_intent_leads_month >= 3
            ? `You captured ${usage.high_intent_leads_month} high-intent leads this month. Upgrade to Growth to export and work them outside Syntrae.`
            : null,
        !usage.features.assistedReplyDrafts && usage.high_intent_leads_month >= 3
            ? 'Upgrade to Growth to turn qualified leads into assisted reply drafts faster.'
            : null,
        usage.automation_runs_daily_limit != null && usage.automation_runs_daily_used >= usage.automation_runs_daily_limit && summary.plan_code !== 'PRO' && summary.plan_code !== 'AGENCY'
            ? 'Your workspace is hitting daily automation limits. Upgrade to Pro to scale multi-brand workflows.'
            : null,
        usage.leads_captured_limit > 0 && usage.leads_captured_month >= Math.max(1, Math.floor(usage.leads_captured_limit * usage.lead_warning_threshold))
            ? `You are at ${usage.leads_captured_month}/${usage.leads_captured_limit} monthly leads${usage.leads_rollover_month ? ` (includes ${usage.leads_rollover_month} rollover leads)` : ''}. New lead capture will stop when the included monthly quota is used. Buy a 100-lead block or upgrade before capture stalls.`
            : null,
        usage.converted_leads_month > 0 && summary.plan_code !== 'AGENCY'
            ? `This workspace already reports ${usage.converted_leads_month} converted leads${usage.estimated_revenue_month ? ` and ${new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR', maximumFractionDigits: 0 }).format(usage.estimated_revenue_month)} in value` : ''}. Consider a higher plan before manual work becomes the bottleneck.`
            : null,
    ].filter(Boolean) as string[] : [];

    if (brands.length > 0) {
        return (
            <div className="p-8 max-w-2xl mx-auto">
                <h1 className="text-2xl font-bold text-red-600 mb-4">Select The Brand To Keep Active</h1>
                <p className="mb-6 text-gray-700">
                    Moving to Basic requires a single active brand. All others will remain paused until you upgrade again.
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
                    {loadingAction === 'resolve-downgrade' ? 'Applying...' : 'Confirm Basic Downgrade'}
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
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6 text-sm">
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
                        <div className="text-xl font-bold">
                            {summary.usage.automation_runs_daily.used} / {summary.usage.automation_runs_daily.limit ?? 'Unlimited'}
                        </div>
                    </div>
                    <div className="rounded border p-4">
                        <div className="text-gray-500">Leads This Month</div>
                        <div className="text-xl font-bold">{summary.lead_quota.used} / {summary.lead_quota.limit}</div>
                    </div>
                </div>
                {usage && (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4 text-sm">
                        <div className="rounded border p-4">
                            <div className="text-gray-500">Included Leads</div>
                            <div className="text-xl font-bold">{summary.lead_quota.included}</div>
                        </div>
                        <div className="rounded border p-4">
                            <div className="text-gray-500">Rollover Leads</div>
                            <div className="text-xl font-bold">{summary.lead_quota.rollover}</div>
                        </div>
                        <div className="rounded border p-4">
                            <div className="text-gray-500">Extra Leads Purchased</div>
                            <div className="text-xl font-bold">{summary.lead_quota.extra}</div>
                        </div>
                        <div className="rounded border p-4">
                            <div className="text-gray-500">High-Intent Leads</div>
                            <div className="text-xl font-bold">{usage.high_intent_leads_month}</div>
                        </div>
                        <div className="rounded border p-4">
                            <div className="text-gray-500">Converted Leads</div>
                            <div className="text-xl font-bold">{usage.converted_leads_month}</div>
                        </div>
                        <div className="rounded border p-4">
                            <div className="text-gray-500">Reported Deal Value</div>
                            <div className="text-xl font-bold">
                                {new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR', maximumFractionDigits: 0 }).format(usage.estimated_revenue_month || 0)}
                            </div>
                        </div>
                    </div>
                )}
                <div className="mt-4 rounded border border-gray-200 bg-gray-50 p-4">
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                        <div>
                            <div className="text-sm font-semibold text-gray-900">Lead capture billing model</div>
                            <p className="mt-1 text-sm text-gray-600">
                                Syntrae now enforces monthly lead limits. When this workspace reaches its included quota, new lead capture stops until you buy another lead block, upgrade the plan, or wait for the next monthly reset.
                            </p>
                            <p className="mt-2 text-xs text-gray-500">
                                Rollover leads (max 100) apply for one month only and are used before new monthly leads.
                            </p>
                            <p className="mt-2 text-xs text-gray-500">
                                Next reset: {new Date(summary.lead_quota.next_reset_at).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' })}
                            </p>
                        </div>
                        <span className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
                            Monthly quota enforced
                        </span>
                    </div>
                    <div className="mt-4 rounded border border-indigo-200 bg-white p-4">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                            <div>
                                <div className="text-sm font-semibold text-gray-900">
                                    Buy {summary.lead_quota.overage_block_size} additional leads
                                </div>
                                <p className="mt-1 text-sm text-gray-600">
                                    Add another block to this workspace when monthly lead capture is close to the limit.
                                </p>
                                <p className="mt-2 text-xs text-gray-500">
                                    Purchased blocks apply immediately and expire at the next monthly reset.
                                </p>
                                {summary.lead_quota.overage_blocks_purchased > 0 && (
                                    <p className="mt-2 text-xs text-gray-500">
                                        Purchased this month: {summary.lead_quota.overage_blocks_purchased} block{summary.lead_quota.overage_blocks_purchased === 1 ? '' : 's'}.
                                    </p>
                                )}
                            </div>
                            <div className="flex flex-col items-start gap-2 md:items-end">
                                <div className="text-sm font-semibold text-slate-900">
                                    {new Intl.NumberFormat('en-MY', {
                                        style: 'currency',
                                        currency: summary.lead_quota.overage_currency,
                                        minimumFractionDigits: 0,
                                        maximumFractionDigits: 0,
                                    }).format(summary.lead_quota.overage_block_price_minor / 100)}
                                </div>
                                <button
                                    onClick={handleLeadBlockCheckout}
                                    disabled={loadingAction === 'lead-block' || !summary.billing.stripe_configured}
                                    className="px-3 py-2 rounded bg-indigo-600 text-white text-sm font-medium disabled:opacity-50"
                                >
                                    {loadingAction === 'lead-block' ? 'Redirecting...' : `Buy ${summary.lead_quota.overage_block_size} Leads`}
                                </button>
                                {!summary.billing.stripe_configured && (
                                    <p className="text-xs text-amber-700">
                                        Stripe is not configured yet for this environment.
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                    {summary.lead_quota.warning_reached && (
                        <div className="mt-4 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                            This workspace is above the 80% lead usage threshold. New lead capture will stop once the monthly allowance is fully used unless you buy another lead block or upgrade first.
                        </div>
                    )}
                </div>
            </div>

            {upgradePrompts.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded p-6">
                    <h2 className="text-lg font-semibold text-amber-800 mb-3">Upgrade Opportunities</h2>
                    <div className="space-y-2 text-sm text-amber-900">
                        {upgradePrompts.map((message) => (
                            <div key={message}>{message}</div>
                        ))}
                    </div>
                </div>
            )}

            <div className="bg-white p-6 rounded shadow">
                <div className="flex items-center justify-between gap-4 mb-4">
                    <h2 className="text-xl font-semibold">Packages</h2>
                    <p className="text-sm text-gray-500">Choose billing interval on each paid plan before checkout.</p>
                </div>
                <div className="mb-4 rounded border border-gray-200 p-4 bg-gray-50">
                    <label className="block text-sm font-medium mb-2">Promo voucher for Stripe checkout</label>
                    <input
                        type="text"
                        className="w-full md:max-w-md p-2 border rounded uppercase bg-white"
                        value={voucherCode}
                        onChange={(event) => setVoucherCode(event.target.value.toUpperCase())}
                        placeholder="Optional campaign or KOL voucher"
                    />
                    <p className="text-xs text-gray-500 mt-2">
                        If valid, the voucher will be attached to the Stripe subscription checkout and applied as free access or trial time after payment setup.
                    </p>
                </div>
                {notice ? <div className="mb-4 rounded border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div> : null}
                <div className="space-y-4">
                    {PLAN_ORDER.map((planCode) => {
                        const isCurrent = summary.plan_code === planCode;
                        const option = summary.plan_options.find((entry) => entry.plan_code === planCode);
                        const selectedInterval = selectedIntervals[planCode] || option?.billing_intervals[0] || 'MONTHLY';
                        const supportsInterval = option?.billing_intervals.includes(selectedInterval) ?? false;
                        const canCheckout = Boolean(option?.checkout_enabled && supportsInterval && planCode !== 'BASIC');
                        return (
                            <div key={planCode} className={`border rounded p-4 ${isCurrent ? 'border-indigo-500 bg-indigo-50' : 'border-gray-200'}`}>
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <h3 className="font-semibold">{planCode}</h3>
                                        <p className="text-sm text-gray-600">{PLAN_COPY[planCode]}</p>
                                        {PLAN_PRICES[planCode] ? <p className="mt-1 text-sm font-semibold text-slate-900">{PLAN_PRICES[planCode]}</p> : null}
                                        {option && (
                                            <p className="text-xs text-gray-500 mt-2">
                                                {option.billing_intervals.map((interval) => interval.toLowerCase()).join(' / ')}
                                            </p>
                                        )}
                                    </div>
                                    {isCurrent ? (
                                        <span className="text-sm font-semibold text-indigo-700">Current</span>
                                    ) : planCode === 'BASIC' ? (
                                        <button
                                            onClick={handleDowngrade}
                                            disabled={loadingAction === 'BASIC'}
                                            className="text-sm text-red-600 hover:underline disabled:opacity-50"
                                        >
                                            {loadingAction === 'BASIC' ? 'Opening...' : (summary.billing.portal_available ? 'Manage downgrade' : 'Move to Basic')}
                                        </button>
                                    ) : canCheckout ? (
                                        <div className="flex items-center gap-2">
                                            <select
                                                value={selectedInterval}
                                                onChange={(event) =>
                                                    setSelectedIntervals((current) => ({
                                                        ...current,
                                                        [planCode]: event.target.value as BillingInterval,
                                                    }))
                                                }
                                                className="rounded border border-gray-300 bg-white px-3 py-2 text-sm"
                                            >
                                                {option?.billing_intervals.map((interval) => (
                                                    <option key={interval} value={interval}>
                                                        {interval === 'MONTHLY' ? 'Monthly checkout' : 'Yearly checkout'}
                                                    </option>
                                                ))}
                                            </select>
                                            <button
                                                onClick={() => handleCheckout(planCode)}
                                                disabled={loadingAction === planCode}
                                                className="px-3 py-2 rounded bg-indigo-600 text-white text-sm font-medium disabled:opacity-50"
                                            >
                                                {loadingAction === planCode ? 'Redirecting...' : 'Checkout'}
                                            </button>
                                        </div>
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
