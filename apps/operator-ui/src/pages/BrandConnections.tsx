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
    }
}

export function BrandConnectionsPage() {
    const { brandId } = useParams<{ brandId: string }>();
    const [connection, setConnection] = useState<PlatformConnection | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [challenge, setChallenge] = useState<ConnectionChallenge | null>(null);

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
            const data = await api.post(`/brands/${brandId}/platform-connections/rednote/challenge`, {}) as ConnectionChallenge;
            setChallenge(data);
            const ingestBase = API_BASE.startsWith('http') ? API_BASE : `${window.location.origin}${API_BASE}`;

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
        } catch (err: any) {
            setError(err.message || 'Failed to disconnect session');
        } finally {
            setBusy(null);
        }
    }

    async function copyCommand() {
        if (!connection?.connect_command) return;
        await navigator.clipboard.writeText(connection.connect_command);
    }

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
                            {busy === 'challenge' ? 'Waiting for extension...' : 'Connect with extension'}
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
                        captures the required cookies locally after you sign in, and uploads the brand-scoped session to Syntrae.
                    </p>

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

                    <div className="mt-8 border-t border-slate-100 pt-6">
                        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Terminal fallback</div>
                        <h3 className="mt-2 text-lg font-bold text-slate-900">Manual worker login</h3>
                        <p className="mt-2 text-sm text-slate-600">
                            Use this only if the extension is unavailable. It opens the worker browser in manual-login mode and writes the
                            session into the brand-scoped path when you press ENTER after login succeeds.
                        </p>

                        <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-950 p-4 text-sm text-slate-100">
                            <code className="break-all">{connection?.connect_command}</code>
                        </div>

                        <button
                            onClick={copyCommand}
                            disabled={!connection?.connect_command}
                            className="mt-4 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700"
                        >
                            Copy command
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
