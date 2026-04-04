import React, { useState } from 'react';
import { Client } from '../lib/api';

interface VerificationErrorState {
    email: string;
    support_email?: string;
}

export function Login() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [verificationRequired, setVerificationRequired] = useState<VerificationErrorState | null>(null);
    const [resent, setResent] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setVerificationRequired(null);
        setLoading(true);
        try {
            await Client.post('/auth/login', { email, password });
            window.location.href = '/';
        } catch (err: any) {
            if (String(err.message || '').toLowerCase().includes('email verification required')) {
                setVerificationRequired({
                    email,
                    support_email: 'support@syntraeai.com',
                });
            } else {
                setError(err.message || 'Login failed');
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
            <div className="bg-white p-8 rounded shadow-md w-full max-w-md">
                <h1 className="text-2xl font-bold mb-2 text-center">Operator Login</h1>
                <p className="text-sm text-gray-600 text-center mb-6">
                    Secure sign-in for your Syntrae workspace.
                </p>
                {error && <div className="bg-red-100 text-red-700 p-3 mb-4 rounded">{error}</div>}
                {verificationRequired && (
                    <div className="bg-amber-50 border border-amber-200 text-amber-900 p-3 mb-4 rounded">
                        <div className="font-medium mb-1">Verify your email first</div>
                        <div className="text-sm mb-3">
                            Your account exists, but email verification is still required before login.
                        </div>
                        <button
                            type="button"
                            onClick={async () => {
                                setLoading(true);
                                setError('');
                                try {
                                    await Client.post('/auth/resend-verification', { email: verificationRequired.email });
                                    setResent(true);
                                } catch (err: any) {
                                    setError(err.message || 'Failed to resend verification email');
                                } finally {
                                    setLoading(false);
                                }
                            }}
                            disabled={loading}
                            className="text-sm text-blue-700 hover:underline disabled:opacity-50"
                        >
                            {loading ? 'Sending...' : 'Resend verification email'}
                        </button>
                        {resent && <div className="text-xs mt-2">Verification email sent.</div>}
                    </div>
                )}
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">Email</label>
                        <input
                            type="email"
                            className="w-full p-2 border rounded"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Password</label>
                        <input
                            type="password"
                            className="w-full p-2 border rounded"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                        />
                    </div>
                    <button type="submit" disabled={loading} className="w-full bg-blue-600 text-white p-2 rounded hover:bg-blue-700 disabled:opacity-50">
                        {loading ? 'Signing In...' : 'Sign In'}
                    </button>
                </form>
                <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
                    <a href="/forgot-password" className="text-blue-600 hover:underline">Forgot password?</a>
                    <a href="/signup" className="text-blue-600 hover:underline">Sign up</a>
                </div>
                <div className="mt-6 text-xs text-gray-500 text-center">
                    Support: <a href="mailto:support@syntraeai.com" className="text-blue-600 hover:underline">support@syntraeai.com</a>
                </div>
            </div>
        </div>
    );
}
