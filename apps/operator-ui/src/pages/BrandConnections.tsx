import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, API_BASE } from '../lib/api';

interface PlatformConnection {
    brand_name: string;
    platform: string;
    provider: string;
    auth_type: string;
    status: string;
    session_present: boolean;
    session_path: string | null;
    recommended_session_path: string;
    active_session_path: string | null;
    session_updated_at: string | null;
    last_checked_at: string | null;
    last_verified_at?: string | null;
    verification_error?: string | null;
    connect_command: string;
    instructions: string[];
    extension_supported?: boolean;
    extension_required_cookie_names?: string[];
    extension_instructions?: string[];
}

interface ConnectionChallenge {
    challenge_id: string;
    nonce: string;
    expires_at: string;
    brand_id: string;
    workspace_id: string;
    platform: string;
    ingest_path: string;
}

declare global {
    interface WindowEventMap {
        SYNTRAE_XHS_CAPTURE_RESULT: CustomEvent<{ success: boolean; error?: string }>;
        SYNTRAE_XHS_EXTENSION_PONG: CustomEvent<{ installed: boolean; version?: string }>;
        SYNTRAE_XHS_CLEAR_SESSION_RESULT: CustomEvent<{ success: boolean; error?: string; cleared?: number }>;
    }
}

type SupportedBrowser = 'chrome' | 'edge' | 'firefox' | 'unknown';

const EXTENSION_STORE_URLS = {
    chrome: import.meta.env.VITE_XHS_EXTENSION_CHROME_URL?.trim() || '',
    edge: import.meta.env.VITE_XHS_EXTENSION_EDGE_URL?.trim() || '',
    firefox: import.meta.env.VITE_XHS_EXTENSION_FIREFOX_URL?.trim() || '',
} as const;

function detectBrowser(userAgent: string): SupportedBrowser {
    const ua = userAgent.toLowerCase();
    if (ua.includes('firefox')) return 'firefox';
    if (ua.includes('edg/')) return 'edge';
    if (ua.includes('chrome/')) return 'chrome';
    return 'unknown';
}

function getExtensionDownloads(browser: SupportedBrowser) {
    if (browser === 'firefox' && EXTENSION_STORE_URLS.firefox) {
        return {
            primaryLabel: 'Add to Firefox',
            primaryHref: EXTENSION_STORE_URLS.firefox,
            primaryExternal: true,
            secondaryLabel: null,
            secondaryHref: null,
            secondaryExternal: false,
        };
    }

    if (browser === 'edge' && EXTENSION_STORE_URLS.edge) {
        return {
            primaryLabel: 'Add to Edge',
            primaryHref: EXTENSION_STORE_URLS.edge,
            primaryExternal: true,
            secondaryLabel: EXTENSION_STORE_URLS.chrome ? 'Use Chrome Web Store link instead' : null,
            secondaryHref: EXTENSION_STORE_URLS.chrome || null,
            secondaryExternal: Boolean(EXTENSION_STORE_URLS.chrome),
        };
    }

    if (browser === 'chrome' && EXTENSION_STORE_URLS.chrome) {
        return {
            primaryLabel: 'Add to Chrome',
            primaryHref: EXTENSION_STORE_URLS.chrome,
            primaryExternal: true,
            secondaryLabel: EXTENSION_STORE_URLS.edge ? 'Use Edge Add-ons link instead' : null,
            secondaryHref: EXTENSION_STORE_URLS.edge || null,
            secondaryExternal: Boolean(EXTENSION_STORE_URLS.edge),
        };
    }

    if (browser === 'firefox') {
        return {
            primaryLabel: 'Download Firefox Extension',
            primaryHref: '/extensions/syntrae-xhs-connector-firefox.zip',
            primaryExternal: false,
            secondaryLabel: null,
            secondaryHref: null,
            secondaryExternal: false,
        };
    }

    const chromiumPackage = '/extensions/syntrae-xhs-connector-chromium.zip';
    return {
        primaryLabel: browser === 'edge' ? 'Download Edge Extension' : 'Download Chrome Extension',
        primaryHref: chromiumPackage,
        primaryExternal: false,
        secondaryLabel: browser === 'chrome' ? 'Use this package for Edge too' : 'Use this package for Chrome too',
        secondaryHref: chromiumPackage,
        secondaryExternal: false,
    };
}

function buildExtensionIngestBase() {
    if (API_BASE.startsWith('http')) return API_BASE;

    const { hostname, port, protocol, origin } = window.location;
    const isLocalHttps = protocol === 'https:' && hostname.endsWith('.localhost.com') && port === '8443';

    // Browser extension background fetches do not reliably inherit local self-signed
    // certificate exceptions. Use the local HTTP edge for the public ingest route only.
    if (isLocalHttps) {
        return `http://${hostname}:8080${API_BASE}`;
    }

    return `${origin}${API_BASE}`;
}

export function BrandConnectionsPage() {
    const { brandId } = useParams<{ brandId: string }>();
    const [connection, setConnection] = useState<PlatformConnection | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [challenge, setChallenge] = useState<ConnectionChallenge | null>(null);
    const [extensionInstalled, setExtensionInstalled] = useState<boolean | null>(null);
    const [showInstallPrompt, setShowInstallPrompt] = useState(false);
    const [browser] = useState<SupportedBrowser>(() => detectBrowser(window.navigator.userAgent));

    useEffect(() => {
        if (brandId) {
            loadConnection();
        }
    }, [brandId]);

    useEffect(() => {
        function handleCaptureResult(event: WindowEventMap['SYNTRAE_XHS_CAPTURE_RESULT']) {
            const detail = event.detail;
            if (detail?.success) {
                setBusy(null);
                setChallenge(null);
                loadConnection();
                return;
            }

            setBusy(null);
            setError(detail?.error || 'XHS extension capture failed');
        }

        window.addEventListener('SYNTRAE_XHS_CAPTURE_RESULT', handleCaptureResult as EventListener);
        return () => window.removeEventListener('SYNTRAE_XHS_CAPTURE_RESULT', handleCaptureResult as EventListener);
    }, []);

    useEffect(() => {
        checkExtensionInstalled();
    }, []);

    async function loadConnection() {
        setLoading(true);
        setError(null);
        try {
            const data = await api.get(`/brands/${brandId}/platform-connections/rednote`) as PlatformConnection;
            setConnection(data);
        } catch (err: any) {
            setError(err.message || 'Failed to load connection status');
        } finally {
            setLoading(false);
        }
    }

    async function checkExtensionInstalled() {
        return new Promise<boolean>((resolve) => {
            const timeout = window.setTimeout(() => {
                window.removeEventListener('SYNTRAE_XHS_EXTENSION_PONG', handlePong as EventListener);
                setExtensionInstalled(false);
                resolve(false);
            }, 900);

            function handlePong(event: WindowEventMap['SYNTRAE_XHS_EXTENSION_PONG']) {
                window.clearTimeout(timeout);
                window.removeEventListener('SYNTRAE_XHS_EXTENSION_PONG', handlePong as EventListener);
                const installed = Boolean(event.detail?.installed);
                setExtensionInstalled(installed);
                resolve(installed);
            }

            window.addEventListener('SYNTRAE_XHS_EXTENSION_PONG', handlePong as EventListener);
            window.postMessage({ type: 'SYNTRAE_XHS_EXTENSION_PING' }, window.location.origin);
        });
    }

    async function clearExtensionSession() {
        const installed = await checkExtensionInstalled();
        if (!installed) {
            throw new Error('Syntrae XHS extension is not available in this tab, so browser Xiaohongshu cookies were not cleared');
        }

        return new Promise<{ success: boolean; error?: string; cleared?: number }>((resolve, reject) => {
            const timeout = window.setTimeout(() => {
                window.removeEventListener('SYNTRAE_XHS_CLEAR_SESSION_RESULT', handleResult as EventListener);
                reject(new Error('Timed out while clearing Xiaohongshu browser cookies'));
            }, 3000);

            function handleResult(event: WindowEventMap['SYNTRAE_XHS_CLEAR_SESSION_RESULT']) {
                window.clearTimeout(timeout);
                window.removeEventListener('SYNTRAE_XHS_CLEAR_SESSION_RESULT', handleResult as EventListener);
                const detail = event.detail || { success: false, error: 'No response from extension' };
                if (detail.success) {
                    resolve(detail);
                    return;
                }
                reject(new Error(detail.error || 'Failed to clear Xiaohongshu browser cookies'));
            }

            window.addEventListener('SYNTRAE_XHS_CLEAR_SESSION_RESULT', handleResult as EventListener);
            window.postMessage({ type: 'SYNTRAE_XHS_CLEAR_SESSION_REQUEST', payload: {} }, window.location.origin);
        });
    }

    async function requestConnection() {
        setBusy('request');
        setError(null);
        try {
            const data = await api.post(`/brands/${brandId}/platform-connections/rednote/request`, {}) as PlatformConnection;
            setConnection(data);
        } catch (err: any) {
            setError(err.message || 'Failed to prepare connection');
        } finally {
            setBusy(null);
        }
    }

    async function createChallenge() {
        setBusy('challenge');
        setError(null);
        try {
            const installed = await checkExtensionInstalled();
            if (!installed) {
                setShowInstallPrompt(true);
                setBusy(null);
                return;
            }

            const data = await api.post(`/brands/${brandId}/platform-connections/rednote/challenge`, {}) as ConnectionChallenge;
            setChallenge(data);
            const ingestBase = buildExtensionIngestBase();

            window.postMessage({
                type: 'SYNTRAE_XHS_CAPTURE_REQUEST',
                payload: {
                    challengeId: data.challenge_id,
                    nonce: data.nonce,
                    ingestUrl: `${ingestBase}${data.ingest_path}`,
                    requiredCookieNames: connection?.extension_required_cookie_names || ['a1', 'web_session'],
                }
            }, window.location.origin);
        } catch (err: any) {
            setError(err.message || 'Failed to create XHS connection challenge');
            setBusy(null);
        }
    }

    async function refreshConnection() {
        setBusy('refresh');
        setError(null);
        try {
            const data = await api.post(`/brands/${brandId}/platform-connections/rednote/refresh`, {}) as PlatformConnection;
            setConnection(data);
        } catch (err: any) {
            setError(err.message || 'Failed to refresh connection');
        } finally {
            setBusy(null);
        }
    }

    async function verifyConnection() {
        setBusy('verify');
        setError(null);
        try {
            const data = await api.post(`/brands/${brandId}/platform-connections/rednote/verify`, {}) as PlatformConnection;
            setConnection(data);
        } catch (err: any) {
            setError(err.message || 'Failed to verify connection');
        } finally {
            setBusy(null);
        }
    }

    async function disconnectConnection() {
        if (!confirm('Disconnect the current XHS session for this brand?')) return;
        setBusy('disconnect');
        setError(null);
        try {
            const data = await api.delete(`/brands/${brandId}/platform-connections/rednote`) as PlatformConnection;
            setConnection(data);
            try {
                await clearExtensionSession();
            } catch (clearErr: any) {
                setError(clearErr?.message || 'Brand session disconnected, but Xiaohongshu browser cookies were not cleared');
            }
        } catch (err: any) {
            setError(err.message || 'Failed to disconnect session');
        } finally {
            setBusy(null);
        }
    }

    const downloads = getExtensionDownloads(browser);
    const usingStoreInstall = downloads.primaryExternal;

    if (loading && !connection) {
        return <div className="p-8 text-slate-600">Loading XHS connection...</div>;
    }

    return (
        <div className="mx-auto max-w-4xl px-6 py-8">
            <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Brand Connection</div>
                <h1 className="mt-3 text-3xl font-bold text-slate-900">Connect Xiaohongshu for {connection?.brand_name ?? 'this brand'}</h1>
                <p className="mt-3 text-sm leading-6 text-slate-600">
                    Syntrae uses a brand-scoped Xiaohongshu session file. Once captured, the automation worker can search and process leads
                    through that account context for this brand only.
                </p>
            </div>

            {error && <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

            {showInstallPrompt && (
                <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-6">
                    <div className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-700">Extension required</div>
                    <h2 className="mt-2 text-xl font-bold text-slate-900">Install the Syntrae XHS Connector first</h2>
                    <p className="mt-2 text-sm text-slate-700">
                        Syntrae did not detect the browser extension in this tab. Install it for {browser === 'unknown' ? 'your browser' : browser},
                        then refresh this page and click <span className="font-semibold">Connect with extension</span> again.
                    </p>

                    <div className="mt-5 flex flex-wrap gap-3">
                        <a
                            href={downloads.primaryHref}
                            {...(downloads.primaryExternal ? { target: '_blank', rel: 'noreferrer' } : { download: true })}
                            className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white"
                        >
                            {downloads.primaryLabel}
                        </a>
                        {downloads.secondaryLabel && downloads.secondaryHref && (
                            <a
                                href={downloads.secondaryHref}
                                {...(downloads.secondaryExternal ? { target: '_blank', rel: 'noreferrer' } : { download: true })}
                                className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700"
                            >
                                {downloads.secondaryLabel}
                            </a>
                        )}
                        <button
                            onClick={() => setShowInstallPrompt(false)}
                            className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700"
                        >
                            Dismiss
                        </button>
                    </div>

                    <ol className="mt-5 space-y-3 text-sm text-slate-700">
                        <li className="rounded-2xl border border-amber-100 bg-white px-4 py-3">
                            <span className="mr-2 font-semibold text-slate-900">1.</span>
                            {usingStoreInstall ? 'Open the browser store listing and install the Syntrae XHS Connector.' : 'Download the extension package for your browser.'}
                        </li>
                        <li className="rounded-2xl border border-amber-100 bg-white px-4 py-3">
                            <span className="mr-2 font-semibold text-slate-900">2.</span>
                            {usingStoreInstall
                                ? 'After installation, return to this tab and click Connect with extension again.'
                                : <>Chrome / Edge: unzip it and use <span className="font-mono">Load unpacked</span>. Firefox: load the package from
                                    <span className="font-mono"> about:debugging</span>.</>}
                        </li>
                        <li className="rounded-2xl border border-amber-100 bg-white px-4 py-3">
                            <span className="mr-2 font-semibold text-slate-900">3.</span>
                            Refresh this page and click <span className="font-semibold">Connect with extension</span>.
                        </li>
                    </ol>
                </div>
            )}

            <div className="mt-6 grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
                <div className="rounded-2xl border border-slate-200 bg-white p-6">
                    <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Status</div>
                    <div className="mt-3 flex items-center gap-3">
                        <div className={`rounded-full px-3 py-1 text-sm font-semibold ${connection?.status === 'CONNECTED'
                            ? 'bg-emerald-100 text-emerald-800'
                            : connection?.status === 'PENDING'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-slate-100 text-slate-700'
                            }`}>
                            {connection?.status ?? 'UNKNOWN'}
                        </div>
                        <div className="text-sm text-slate-500">
                            {connection?.session_present ? 'Session file detected' : 'No session file detected'}
                        </div>
                    </div>

                    <dl className="mt-6 space-y-3 text-sm">
                        <div>
                            <dt className="font-semibold text-slate-700">Recommended session path</dt>
                            <dd className="mt-1 break-all text-slate-600">{connection?.recommended_session_path}</dd>
                        </div>
                        <div>
                            <dt className="font-semibold text-slate-700">Active session path</dt>
                            <dd className="mt-1 break-all text-slate-600">{connection?.active_session_path ?? 'Not connected yet'}</dd>
                        </div>
                        <div>
                            <dt className="font-semibold text-slate-700">Last checked</dt>
                            <dd className="mt-1 text-slate-600">{connection?.last_checked_at ? new Date(connection.last_checked_at).toLocaleString() : 'Never'}</dd>
                        </div>
                        <div>
                            <dt className="font-semibold text-slate-700">Session updated</dt>
                            <dd className="mt-1 text-slate-600">{connection?.session_updated_at ? new Date(connection.session_updated_at).toLocaleString() : 'No session file yet'}</dd>
                        </div>
                        <div>
                            <dt className="font-semibold text-slate-700">Last verified</dt>
                            <dd className="mt-1 text-slate-600">{connection?.last_verified_at ? new Date(connection.last_verified_at).toLocaleString() : 'Not verified yet'}</dd>
                        </div>
                        {connection?.verification_error && (
                            <div>
                                <dt className="font-semibold text-rose-700">Verification issue</dt>
                                <dd className="mt-1 text-rose-600">{connection.verification_error}</dd>
                            </div>
                        )}
                    </dl>

                    <div className="mt-6 flex flex-wrap gap-3">
                        <button
                            onClick={requestConnection}
                            disabled={busy !== null}
                            className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white"
                        >
                            {busy === 'request' ? 'Preparing...' : 'Prepare connection'}
                        </button>
                        <button
                            onClick={createChallenge}
                            disabled={busy !== null}
                            className="rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white"
                        >
                            {busy === 'challenge'
                                ? 'Waiting for extension...'
                                : connection?.session_present
                                    ? 'Replace session with extension'
                                    : 'Connect with extension'}
                        </button>
                        <button
                            onClick={refreshConnection}
                            disabled={busy !== null}
                            className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700"
                        >
                            {busy === 'refresh' ? 'Refreshing...' : 'Refresh status'}
                        </button>
                        <button
                            onClick={verifyConnection}
                            disabled={busy !== null}
                            className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700"
                        >
                            {busy === 'verify' ? 'Verifying...' : 'Verify session'}
                        </button>
                        <button
                            onClick={disconnectConnection}
                            disabled={busy !== null}
                            className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-700"
                        >
                            {busy === 'disconnect' ? 'Disconnecting...' : 'Disconnect'}
                        </button>
                    </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-6">
                    <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Extension capture</div>
                    <h2 className="mt-2 text-xl font-bold text-slate-900">Capture the XHS session locally</h2>
                    <p className="mt-2 text-sm text-slate-600">
                        The recommended commercial flow is the Syntrae browser extension. It opens Xiaohongshu login in your own browser,
                        captures the required cookies locally after you sign in, and uploads the brand-scoped session to Syntrae. Disconnect also
                        clears Xiaohongshu cookies in this browser profile so the next connect flow can prompt for a fresh login.
                    </p>

                    <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                        Extension status: <span className="font-semibold text-slate-900">{extensionInstalled ? 'Installed' : 'Not detected'}</span>
                    </div>

                    {challenge && (
                        <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
                            Extension challenge created. Complete the login/capture flow in the extension, then use refresh or verify.
                        </div>
                    )}

                    <ol className="mt-6 space-y-3 text-sm text-slate-600">
                        {(connection?.extension_instructions || []).map((instruction, index) => (
                            <li key={instruction} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                                <span className="mr-2 font-semibold text-slate-900">{index + 1}.</span>
                                {instruction}
                            </li>
                        ))}
                    </ol>
                </div>
            </div>
        </div>
    );
}
