import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

type ChecklistKey = 'brand_basics' | 'platform_selection' | 'market_profile';

interface OnboardingStatus {
    workspace: {
        id: string;
        name: string;
        onboarding_state: string;
        plan_id: string;
        status: string;
    };
    primary_brand: {
        id: string;
        name: string;
        domain: string;
        status: string;
    } | null;
    owner_settings: {
        platforms_enabled?: string | null;
    } | null;
    active_market_profile: {
        id: string;
        name: string;
        status: string;
        is_active: boolean;
    } | null;
    checklist: Record<ChecklistKey, boolean>;
    is_complete: boolean;
}

const CATEGORY_OPTIONS = [
    'SKINCARE',
    'BEAUTY',
    'FITNESS',
    'SAAS',
    'EDUCATION',
    'LOCAL_SERVICE',
    'ECOM_GENERAL',
];

const PLATFORM_OPTIONS = [
    { value: 'rednote', label: 'Xiaohongshu (Recommended)' },
    { value: 'tiktok', label: 'TikTok' },
];

const CHECKLIST_LABELS: Record<ChecklistKey, string> = {
    brand_basics: 'Brand basics',
    platform_selection: 'Platform focus',
    market_profile: 'Market profile',
};

function parseStringArray(value?: string | null) {
    if (!value) return [] as string[];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
        return [];
    }
}

function parseCommaSeparated(value: string) {
    return value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

function currentStep(checklist: Record<ChecklistKey, boolean>) {
    if (!checklist.brand_basics) return 1;
    if (!checklist.platform_selection) return 2;
    if (!checklist.market_profile) return 3;
    return 4;
}

export function OnboardingPage() {
    const [status, setStatus] = useState<OnboardingStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [savingStep, setSavingStep] = useState<string | null>(null);

    const [brandName, setBrandName] = useState('');
    const [brandDomain, setBrandDomain] = useState('');
    const [platforms, setPlatforms] = useState<string[]>(['rednote']);
    const [profileName, setProfileName] = useState('Primary Discovery Profile');
    const [primaryCategory, setPrimaryCategory] = useState('ECOM_GENERAL');
    const [targetAudience, setTargetAudience] = useState('');
    const [languages, setLanguages] = useState('en, zh');
    const [positiveKeywords, setPositiveKeywords] = useState('');
    const [negativeKeywords, setNegativeKeywords] = useState('cheap, discount, giveaway');

    useEffect(() => {
        loadStatus();
    }, []);

    const step = useMemo(() => currentStep(status?.checklist ?? {
        brand_basics: false,
        platform_selection: false,
        market_profile: false,
    }), [status]);

    async function loadStatus() {
        setLoading(true);
        setError(null);
        try {
            const nextStatus = await api.get('/onboarding/status') as OnboardingStatus;
            setStatus(nextStatus);
            setBrandName(nextStatus.primary_brand?.name && nextStatus.primary_brand.name !== 'Default Brand'
                ? nextStatus.primary_brand.name
                : nextStatus.workspace.name);
            setBrandDomain(nextStatus.primary_brand?.domain && nextStatus.primary_brand.domain !== 'general'
                ? nextStatus.primary_brand.domain
                : '');
            const nextPlatforms = parseStringArray(nextStatus.owner_settings?.platforms_enabled);
            setPlatforms(nextPlatforms.length > 0 ? nextPlatforms : ['rednote']);
            if (nextStatus.primary_brand?.name && nextStatus.primary_brand.name !== 'Default Brand') {
                setProfileName(`${nextStatus.primary_brand.name} Discovery Profile`);
            }
        } catch (err: any) {
            setError(err.message || 'Failed to load onboarding status');
        } finally {
            setLoading(false);
        }
    }

    async function saveBrandBasics(event: React.FormEvent) {
        event.preventDefault();
        if (!status?.primary_brand) {
            setError('No primary brand found for this workspace.');
            return;
        }
        setSavingStep('brand');
        setError(null);
        try {
            await api.patch(`/brands/${status.primary_brand.id}`, {
                name: brandName,
                domain: brandDomain,
            });
            await loadStatus();
        } catch (err: any) {
            setError(err.message || 'Failed to save brand basics');
        } finally {
            setSavingStep(null);
        }
    }

    async function savePlatforms(event: React.FormEvent) {
        event.preventDefault();
        if (platforms.length === 0) {
            setError('Select at least one platform to continue.');
            return;
        }
        setSavingStep('platforms');
        setError(null);
        try {
            await api.put('/owner/settings', {
                platforms_enabled: JSON.stringify(platforms),
            });
            await loadStatus();
        } catch (err: any) {
            setError(err.message || 'Failed to save platform settings');
        } finally {
            setSavingStep(null);
        }
    }

    async function createMarketProfile(event: React.FormEvent) {
        event.preventDefault();
        if (!status?.primary_brand) {
            setError('No primary brand found for this workspace.');
            return;
        }

        const keywordsPositive = parseCommaSeparated(positiveKeywords);
        const keywordsNegative = parseCommaSeparated(negativeKeywords);
        const selectedLanguages = parseCommaSeparated(languages);

        if (keywordsPositive.length < 3) {
            setError('Add at least 3 positive keywords for the first market profile.');
            return;
        }
        if (keywordsPositive.length > 3) {
            setError('Use exactly 3 positive keywords. Syntrae discovery only uses the first 3.');
            return;
        }
        if (keywordsNegative.length < 1) {
            setError('Add at least 1 negative keyword for the first market profile.');
            return;
        }
        if (!targetAudience.trim()) {
            setError('Describe the target audience before creating the market profile.');
            return;
        }

        setSavingStep('profile');
        setError(null);
        try {
            await api.post(`/brands/${status.primary_brand.id}/market-profiles`, {
                name: profileName,
                primary_category: primaryCategory,
                target_audience: targetAudience.trim(),
                languages: selectedLanguages.length > 0 ? selectedLanguages : ['en'],
                keywords_positive: keywordsPositive,
                keywords_negative: keywordsNegative,
                hashtags_positive: [],
                hashtags_negative: [],
                excluded_topics: [],
                discovery_intent: 'BALANCED',
            });
            await loadStatus();
        } catch (err: any) {
            setError(err.message || 'Failed to create the first market profile');
        } finally {
            setSavingStep(null);
        }
    }

    async function completeOnboarding() {
        setSavingStep('complete');
        setError(null);
        try {
            await api.post('/onboarding/complete', {});
            window.location.href = '/';
        } catch (err: any) {
            setError(err.message || 'Failed to complete onboarding');
        } finally {
            setSavingStep(null);
        }
    }

    function togglePlatform(value: string) {
        setPlatforms(current =>
            current.includes(value) ? current.filter(item => item !== value) : [...current, value]
        );
    }

    if (loading || !status) {
        return <div className="p-8 text-slate-600">Loading onboarding...</div>;
    }

    return (
        <div className="mx-auto max-w-5xl px-6 py-8">
            <div className="rounded-3xl border border-amber-200 bg-[linear-gradient(135deg,#fff7ed,#ffffff)] p-8 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">Workspace Setup</div>
                <h1 className="mt-3 text-3xl font-bold text-slate-900">Finish your first Syntrae workspace</h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                    This setup gets your first brand into a usable state: define the business, choose where discovery runs, and create the
                    first market profile so lead search has real targeting context.
                </p>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-4">
                {[1, 2, 3, 4].map(item => (
                    <div
                        key={item}
                        className={`rounded-2xl border px-4 py-4 ${item === step ? 'border-teal-300 bg-teal-50' : 'border-slate-200 bg-white'}`}
                    >
                        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Step {item}</div>
                        <div className="mt-2 text-sm font-semibold text-slate-900">
                            {item === 1 && 'Brand'}
                            {item === 2 && 'Platform'}
                            {item === 3 && 'Market Profile'}
                            {item === 4 && 'Launch'}
                        </div>
                    </div>
                ))}
            </div>

            <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
                <div className="text-sm font-semibold text-slate-900">Progress checklist</div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                    {(Object.keys(status.checklist) as ChecklistKey[]).map(key => (
                        <div
                            key={key}
                            className={`rounded-2xl border px-4 py-3 text-sm ${status.checklist[key]
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                : 'border-slate-200 bg-slate-50 text-slate-600'
                                }`}
                        >
                            {status.checklist[key] ? 'Done' : 'Pending'}: {CHECKLIST_LABELS[key]}
                        </div>
                    ))}
                </div>
                {error && <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
                <form onSubmit={saveBrandBasics} className="rounded-2xl border border-slate-200 bg-white p-6">
                    <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Step 1</div>
                    <h2 className="mt-2 text-xl font-bold text-slate-900">Set the primary brand</h2>
                    <p className="mt-2 text-sm text-slate-600">Replace the default placeholder brand so your workspace reflects the actual business you are targeting.</p>
                    <div className="mt-6 space-y-4">
                        <div>
                            <label className="mb-1 block text-sm font-medium text-slate-700">Brand name</label>
                            <input
                                className="w-full rounded-xl border border-slate-200 px-3 py-2.5"
                                value={brandName}
                                onChange={event => setBrandName(event.target.value)}
                                placeholder="Acme Beauty"
                                required
                            />
                        </div>
                        <div>
                            <label className="mb-1 block text-sm font-medium text-slate-700">Website or domain</label>
                            <input
                                className="w-full rounded-xl border border-slate-200 px-3 py-2.5"
                                value={brandDomain}
                                onChange={event => setBrandDomain(event.target.value)}
                                placeholder="acmebeauty.com"
                                required
                            />
                        </div>
                    </div>
                    <button
                        type="submit"
                        className="mt-6 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white"
                        disabled={savingStep === 'brand'}
                    >
                        {savingStep === 'brand' ? 'Saving...' : 'Save brand basics'}
                    </button>
                </form>

                <form onSubmit={savePlatforms} className="rounded-2xl border border-slate-200 bg-white p-6">
                    <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Step 2</div>
                    <h2 className="mt-2 text-xl font-bold text-slate-900">Choose platform focus</h2>
                    <p className="mt-2 text-sm text-slate-600">Start with the platforms you want discovery runs and market profiling to prioritize.</p>
                    <div className="mt-6 space-y-3">
                        {PLATFORM_OPTIONS.map(option => (
                            <label key={option.value} className="flex items-start gap-3 rounded-2xl border border-slate-200 px-4 py-3">
                                <input
                                    type="checkbox"
                                    checked={platforms.includes(option.value)}
                                    onChange={() => togglePlatform(option.value)}
                                    className="mt-1 h-4 w-4"
                                />
                                <span>
                                    <span className="block text-sm font-semibold text-slate-900">{option.label}</span>
                                    <span className="block text-sm text-slate-500">
                                        {option.value === 'rednote'
                                            ? 'Recommended for this beta. This enables Xiaohongshu-first discovery and lead targeting.'
                                            : 'Optional secondary channel if you also want TikTok discovery in the same workspace.'}
                                    </span>
                                </span>
                            </label>
                        ))}
                    </div>
                    <button
                        type="submit"
                        className="mt-6 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white"
                        disabled={savingStep === 'platforms'}
                    >
                        {savingStep === 'platforms' ? 'Saving...' : 'Save platform focus'}
                    </button>
                </form>
            </div>

            <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Step 3</div>
                        <h2 className="mt-2 text-xl font-bold text-slate-900">Create the first market profile</h2>
                        <p className="mt-2 max-w-2xl text-sm text-slate-600">
                            This profile tells Syntrae what kind of posts and comments should count as relevant leads for this brand.
                        </p>
                    </div>
                    {status.active_market_profile && status.primary_brand && (
                        <Link
                            to={`/brands/${status.primary_brand.id}/market-profiles`}
                            className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700"
                        >
                            Open advanced editor
                        </Link>
                    )}
                </div>

                {status.active_market_profile ? (
                    <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
                        Active profile ready: <strong>{status.active_market_profile.name}</strong>. You can continue to launch or refine it in the advanced editor later.
                    </div>
                ) : (
                    <form onSubmit={createMarketProfile} className="mt-6 grid gap-4 lg:grid-cols-2">
                        <div>
                            <label className="mb-1 block text-sm font-medium text-slate-700">Profile name</label>
                            <input
                                className="w-full rounded-xl border border-slate-200 px-3 py-2.5"
                                value={profileName}
                                onChange={event => setProfileName(event.target.value)}
                                required
                            />
                        </div>
                        <div>
                            <label className="mb-1 block text-sm font-medium text-slate-700">Primary category</label>
                            <select
                                className="w-full rounded-xl border border-slate-200 px-3 py-2.5"
                                value={primaryCategory}
                                onChange={event => setPrimaryCategory(event.target.value)}
                            >
                                {CATEGORY_OPTIONS.map(option => (
                                    <option key={option} value={option}>{option}</option>
                                ))}
                            </select>
                        </div>
                        <div className="lg:col-span-2">
                            <label className="mb-1 block text-sm font-medium text-slate-700">Target audience</label>
                            <textarea
                                className="min-h-[110px] w-full rounded-xl border border-slate-200 px-3 py-2.5"
                                value={targetAudience}
                                onChange={event => setTargetAudience(event.target.value)}
                                placeholder="Example: Chinese-speaking skincare shoppers in Singapore looking for premium routines, before-and-after proof, and trusted product reviews."
                                required
                            />
                        </div>
                        <div>
                            <label className="mb-1 block text-sm font-medium text-slate-700">Languages</label>
                            <input
                                className="w-full rounded-xl border border-slate-200 px-3 py-2.5"
                                value={languages}
                                onChange={event => setLanguages(event.target.value)}
                                placeholder="en, zh"
                            />
                        </div>
                        <div>
                            <label className="mb-1 block text-sm font-medium text-slate-700">Negative keywords</label>
                            <input
                                className="w-full rounded-xl border border-slate-200 px-3 py-2.5"
                                value={negativeKeywords}
                                onChange={event => setNegativeKeywords(event.target.value)}
                                placeholder="cheap, giveaway, scam"
                            />
                        </div>
                        <div className="lg:col-span-2">
                            <label className="mb-1 block text-sm font-medium text-slate-700">Positive keywords</label>
                            <textarea
                                className="min-h-[96px] w-full rounded-xl border border-slate-200 px-3 py-2.5"
                                value={positiveKeywords}
                                onChange={event => setPositiveKeywords(event.target.value)}
                                placeholder="hydrating serum, sensitive skin, skin barrier repair, redness reduction"
                                required
                            />
                            <p className="mt-2 text-xs text-slate-500">Comma-separated. Use exactly 3 phrases because discovery only uses 3 positive keywords per run.</p>
                        </div>
                        <div className="lg:col-span-2">
                            <button
                                type="submit"
                                className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white"
                                disabled={savingStep === 'profile'}
                            >
                                {savingStep === 'profile' ? 'Creating...' : 'Create first market profile'}
                            </button>
                        </div>
                    </form>
                )}
            </div>

            <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
                <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Step 4</div>
                <h2 className="mt-2 text-xl font-bold text-slate-900">Enter the workspace</h2>
                <p className="mt-2 text-sm text-slate-600">
                    Once these setup steps are complete, Syntrae will unlock the full dashboard and use this configuration as the baseline for discovery and lead processing.
                </p>
                <button
                    onClick={completeOnboarding}
                    disabled={!status.is_complete || savingStep === 'complete'}
                    className={`mt-6 rounded-2xl px-5 py-3 text-sm font-semibold ${status.is_complete
                        ? 'bg-teal-700 text-white'
                        : 'bg-slate-200 text-slate-500'
                        }`}
                >
                    {savingStep === 'complete' ? 'Finalizing...' : 'Finish onboarding'}
                </button>
            </div>
        </div>
    );
}
