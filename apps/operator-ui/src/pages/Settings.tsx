import { useEffect, useState } from 'react';
import { Client } from '../lib/api';

type EngagementMode = 'OBSERVE_ONLY' | 'SUGGEST' | 'ASSIST';
type Aggressiveness = 'CONSERVATIVE' | 'BALANCED' | 'ASSERTIVE';
type ReplyQualifiedMode = 'MANUAL_REVIEW' | 'DIRECT_SEND_AI';
type ReplyRedirectTarget = 'STORE' | 'PROFILE' | 'PINNED_POST' | 'CUSTOMER_SERVICE';
type ReplyCtaStyle = 'SOFT' | 'DIRECT';

interface OwnerSettings {
    mode: EngagementMode;
    aggressiveness: Aggressiveness;
    max_suggestions_per_day: number;
    max_suggestions_per_video: number;
    tone?: string | null;
    reply_qualified_mode: ReplyQualifiedMode;
    reply_redirect_target: ReplyRedirectTarget;
    reply_cta_style: ReplyCtaStyle;
    auto_reply_confidence_threshold: number;
    reply_require_human_review_high_risk: boolean;
}

function clampInteger(value: string, min: number, max: number) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
}

function clampDecimal(value: string, min: number, max: number) {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
}

const MODE_COPY: Record<EngagementMode, { label: string; help: string }> = {
    OBSERVE_ONLY: {
        label: 'Observe only',
        help: 'Capture and analyze signals without preparing outbound replies.',
    },
    SUGGEST: {
        label: 'Suggest replies',
        help: 'Generate reply drafts and keep a human in the review loop.',
    },
    ASSIST: {
        label: 'Auto-send qualified replies',
        help: 'Allow the system to auto-send high-confidence replies when the workflow permits it.',
    },
};

const AGGRESSIVENESS_COPY: Record<Aggressiveness, { label: string; help: string }> = {
    CONSERVATIVE: {
        label: 'Conservative',
        help: 'Tighter filtering and lower reply volume.',
    },
    BALANCED: {
        label: 'Balanced',
        help: 'Recommended default for most workspaces.',
    },
    ASSERTIVE: {
        label: 'Assertive',
        help: 'Broader signal capture with higher reply volume.',
    },
};

export function Settings() {
    const [settings, setSettings] = useState<OwnerSettings | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await Client.get('/owner/settings') as OwnerSettings;
            setSettings(data);
        } catch (e: any) {
            console.error(e);
            setError(e.message || 'Failed to load workspace settings');
        } finally {
            setLoading(false);
        }
    };

    const handleChange = <K extends keyof OwnerSettings>(field: K, value: OwnerSettings[K]) => {
        if (!settings) return;
        setSettings({ ...settings, [field]: value });
    };

    const handleSave = async () => {
        if (!settings) return;
        try {
            setSaving(true);
            setError(null);
            setSuccess(null);

            const payload: OwnerSettings = {
                mode: settings.mode,
                aggressiveness: settings.aggressiveness,
                max_suggestions_per_day: Math.max(0, settings.max_suggestions_per_day),
                max_suggestions_per_video: Math.max(0, settings.max_suggestions_per_video),
                tone: settings.tone?.trim() || '',
                reply_qualified_mode: settings.reply_qualified_mode,
                reply_redirect_target: settings.reply_redirect_target,
                reply_cta_style: settings.reply_cta_style,
                auto_reply_confidence_threshold: Math.min(1, Math.max(0, settings.auto_reply_confidence_threshold)),
                reply_require_human_review_high_risk: Boolean(settings.reply_require_human_review_high_risk),
            };

            await Client.put('/owner/settings', payload);
            setSettings(payload);
            setSuccess('Workspace settings updated.');
        } catch (e: any) {
            console.error(e);
            setError(e.message || 'Failed to save workspace settings');
        } finally {
            setSaving(false);
        }
    };

    if (loading || !settings) {
        return <div className="p-8 text-slate-600">Loading workspace settings...</div>;
    }

    return (
        <div className="mx-auto max-w-5xl px-6 py-8">
            <div className="rounded-3xl border border-slate-200 bg-[linear-gradient(135deg,#f8fafc,#ffffff_45%,#eff6ff)] p-8 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Workspace Settings</div>
                <h1 className="mt-3 text-3xl font-bold text-slate-900">Reply and review preferences</h1>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                    Configure how Syntrae handles reply drafting, review gates, and reply routing for this workspace.
                </p>
            </div>

            {error && (
                <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {error}
                </div>
            )}
            {success && (
                <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                    {success}
                </div>
            )}

            <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1fr]">
                <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Automation Behavior</div>
                    <h2 className="mt-2 text-xl font-bold text-slate-900">Reply handling mode</h2>
                    <p className="mt-2 text-sm text-slate-600">
                        Choose how proactive Syntrae should be when moving from captured signals to reply output.
                    </p>

                    <div className="mt-6 grid gap-3">
                        {(Object.keys(MODE_COPY) as EngagementMode[]).map((mode) => (
                            <label
                                key={mode}
                                className={`rounded-2xl border px-4 py-4 ${settings.mode === mode ? 'border-teal-300 bg-teal-50' : 'border-slate-200 bg-white'}`}
                            >
                                <input
                                    type="radio"
                                    name="workspace-mode"
                                    className="sr-only"
                                    checked={settings.mode === mode}
                                    onChange={() => handleChange('mode', mode)}
                                />
                                <div className="text-sm font-semibold text-slate-900">{MODE_COPY[mode].label}</div>
                                <div className="mt-1 text-sm text-slate-600">{MODE_COPY[mode].help}</div>
                            </label>
                        ))}
                    </div>

                    <div className="mt-6">
                        <label className="mb-1 block text-sm font-medium text-slate-700">Capture strictness</label>
                        <select
                            className="w-full rounded-xl border border-slate-200 px-3 py-2.5"
                            value={settings.aggressiveness}
                            onChange={(e) => handleChange('aggressiveness', e.target.value as Aggressiveness)}
                        >
                            {(Object.keys(AGGRESSIVENESS_COPY) as Aggressiveness[]).map((level) => (
                                <option key={level} value={level}>{AGGRESSIVENESS_COPY[level].label}</option>
                            ))}
                        </select>
                        <p className="mt-2 text-xs text-slate-500">{AGGRESSIVENESS_COPY[settings.aggressiveness].help}</p>
                    </div>
                </section>

                <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Draft Limits</div>
                    <h2 className="mt-2 text-xl font-bold text-slate-900">Daily draft caps</h2>
                    <p className="mt-2 text-sm text-slate-600">
                        Control how many reply drafts Syntrae can prepare for this workspace.
                    </p>

                    <div className="mt-6 grid gap-4 md:grid-cols-2">
                        <label className="block">
                            <span className="text-sm font-medium text-slate-700">Max draft suggestions / day</span>
                            <input
                                type="number"
                                min={0}
                                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5"
                                value={settings.max_suggestions_per_day}
                                onChange={(e) => handleChange('max_suggestions_per_day', clampInteger(e.target.value, 0, 999))}
                            />
                        </label>
                        <label className="block">
                            <span className="text-sm font-medium text-slate-700">Max draft suggestions / video</span>
                            <input
                                type="number"
                                min={0}
                                className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5"
                                value={settings.max_suggestions_per_video}
                                onChange={(e) => handleChange('max_suggestions_per_video', clampInteger(e.target.value, 0, 99))}
                            />
                        </label>
                    </div>

                    <div className="mt-6">
                        <label className="mb-1 block text-sm font-medium text-slate-700">Preferred tone</label>
                        <input
                            type="text"
                            placeholder="Friendly, credible, and direct"
                            className="w-full rounded-xl border border-slate-200 px-3 py-2.5"
                            value={settings.tone || ''}
                            onChange={(e) => handleChange('tone', e.target.value)}
                        />
                    </div>
                </section>
            </div>

            <section className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Reply Workflow</div>
                <h2 className="mt-2 text-xl font-bold text-slate-900">Review and sending rules</h2>
                <p className="mt-2 text-sm text-slate-600">
                    Decide when drafts must be reviewed, where replies should point users, and how confident the system must be before auto-send is allowed.
                </p>

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                    <label className="block">
                        <span className="text-sm font-medium text-slate-700">Qualified reply handling</span>
                        <select
                            className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5"
                            value={settings.reply_qualified_mode}
                            onChange={(e) => handleChange('reply_qualified_mode', e.target.value as ReplyQualifiedMode)}
                        >
                            <option value="MANUAL_REVIEW">Manual review required</option>
                            <option value="DIRECT_SEND_AI">Allow direct AI send</option>
                        </select>
                    </label>

                    <label className="block">
                        <span className="text-sm font-medium text-slate-700">Reply destination</span>
                        <select
                            className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5"
                            value={settings.reply_redirect_target}
                            onChange={(e) => handleChange('reply_redirect_target', e.target.value as ReplyRedirectTarget)}
                        >
                            <option value="STORE">Store</option>
                            <option value="PROFILE">Profile</option>
                            <option value="PINNED_POST">Pinned post</option>
                            <option value="CUSTOMER_SERVICE">Customer service</option>
                        </select>
                    </label>

                    <label className="block">
                        <span className="text-sm font-medium text-slate-700">Call-to-action style</span>
                        <select
                            className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5"
                            value={settings.reply_cta_style}
                            onChange={(e) => handleChange('reply_cta_style', e.target.value as ReplyCtaStyle)}
                        >
                            <option value="SOFT">Soft</option>
                            <option value="DIRECT">Direct</option>
                        </select>
                    </label>

                    <label className="block">
                        <span className="text-sm font-medium text-slate-700">Auto-send confidence threshold</span>
                        <input
                            type="number"
                            min="0"
                            max="1"
                            step="0.05"
                            className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5"
                            value={settings.auto_reply_confidence_threshold ?? 0.9}
                            onChange={(e) => handleChange('auto_reply_confidence_threshold', clampDecimal(e.target.value, 0, 1))}
                        />
                    </label>
                </div>

                <label className="mt-6 flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-700">
                    <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 rounded border-slate-300"
                        checked={Boolean(settings.reply_require_human_review_high_risk)}
                        onChange={(e) => handleChange('reply_require_human_review_high_risk', e.target.checked)}
                    />
                    <span>
                        <span className="block font-semibold text-slate-900">Always review high-risk replies manually</span>
                        <span className="mt-1 block text-slate-600">Recommended. This keeps risky reply drafts out of auto-send even when the workspace is in a more automated mode.</span>
                    </span>
                </label>
            </section>

            <div className="mt-6 flex items-center justify-end gap-3">
                <span className="text-sm text-slate-500">These preferences apply across the current workspace.</span>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                    {saving ? 'Saving...' : 'Save Settings'}
                </button>
            </div>
        </div>
    );
}
