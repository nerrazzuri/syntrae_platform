import React, { useState } from 'react';
import { Client } from '../lib/api';

interface SignupResponse {
    status: 'verification_required';
    email: string;
    message: string;
    support_email: string;
    privacy_url: string;
    terms_url: string;
}

export function Signup() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [workspaceName, setWorkspaceName] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<SignupResponse | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const response = await Client.post('/auth/signup', {
                email,
                password,
                workspace_name: workspaceName
            });
            setResult(response);
        } catch (err: any) {
            setError(err.message || 'Signup failed');
        } finally {
            setLoading(false);
        }
    };

    if (result) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
                <div className="bg-white p-8 rounded shadow-md w-full max-w-lg">
                    <h1 className="text-2xl font-bold mb-4 text-center">Check Your Inbox</h1>
                    <p className="text-gray-700 mb-4">
                        We sent a verification link to <strong>{result.email}</strong>. You need to verify your email before signing in.
                    </p>
                    <p className="text-sm text-gray-600 mb-6">{result.message}</p>
                    <div className="space-y-3">
                        <a href="/login" className="block w-full text-center bg-blue-600 text-white p-2 rounded hover:bg-blue-700">
                            Go To Login
                        </a>
                        <button
                            onClick={async () => {
                                setLoading(true);
                                setError('');
                                try {
                                    await Client.post('/auth/resend-verification', { email: result.email });
                                } catch (err: any) {
                                    setError(err.message || 'Failed to resend verification email');
                                } finally {
                                    setLoading(false);
                                }
                            }}
                            disabled={loading}
                            className="w-full border border-gray-300 p-2 rounded hover:bg-gray-50 disabled:opacity-50"
                        >
                            {loading ? 'Resending...' : 'Resend Verification Email'}
                        </button>
                    </div>
                    {error && <div className="bg-red-100 text-red-700 p-3 mt-4 rounded">{error}</div>}
                    <div className="mt-6 text-xs text-gray-500">
                        Need help? <a className="text-blue-600 hover:underline" href={`mailto:${result.support_email}`}>{result.support_email}</a>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
            <div className="bg-white p-8 rounded shadow-md w-full max-w-md">
                <h1 className="text-2xl font-bold mb-2 text-center">Create Account</h1>
                <p className="text-sm text-gray-600 text-center mb-6">
                    We will verify your email before activating your Syntrae workspace.
                </p>
                {error && <div className="bg-red-100 text-red-700 p-3 mb-4 rounded">{error}</div>}
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">Work Email</label>
                        <input
                            type="email"
                            className="w-full p-2 border rounded"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            required
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Company/Workspace Name</label>
                        <input
                            type="text"
                            className="w-full p-2 border rounded"
                            value={workspaceName}
                            onChange={e => setWorkspaceName(e.target.value)}
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
                            minLength={8}
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-green-600 text-white p-2 rounded hover:bg-green-700 disabled:opacity-50"
                    >
                        {loading ? 'Creating Account...' : 'Sign Up'}
                    </button>
                </form>
                <div className="mt-4 text-center text-sm text-gray-600">
                    Already have an account? <a href="/login" className="text-blue-600 hover:underline">Log in</a>
                </div>
                <div className="mt-6 text-xs text-gray-500 text-center">
                    By signing up, you agree to our <a href="https://syntraeai.com/terms" className="text-blue-600 hover:underline">Terms</a> and <a href="https://syntraeai.com/privacy" className="text-blue-600 hover:underline">Privacy Policy</a>.
                </div>
                <div className="mt-2 text-xs text-gray-500 text-center">
                    Support: <a href="mailto:support@syntraeai.com" className="text-blue-600 hover:underline">support@syntraeai.com</a>
                </div>
            </div>
        </div>
    );
}
