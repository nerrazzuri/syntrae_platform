import React, { useState } from 'react';
import { Client } from '../lib/api';

export function ForgotPasswordPage() {
    const [email, setEmail] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const res = await Client.post('/auth/forgot-password', { email });
            setMessage(res.message || 'If that account exists, a password reset email has been sent.');
        } catch (err: any) {
            setError(err.message || 'Request failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
            <div className="bg-white p-8 rounded shadow-md w-full max-w-md">
                <h1 className="text-2xl font-bold mb-2 text-center">Reset Password</h1>
                <p className="text-sm text-gray-600 text-center mb-6">
                    Enter your email and we will send you a password reset link.
                </p>
                {message && <div className="bg-green-100 text-green-800 p-3 mb-4 rounded">{message}</div>}
                {error && <div className="bg-red-100 text-red-700 p-3 mb-4 rounded">{error}</div>}
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
                    <button type="submit" disabled={loading} className="w-full bg-blue-600 text-white p-2 rounded hover:bg-blue-700 disabled:opacity-50">
                        {loading ? 'Sending...' : 'Send Reset Link'}
                    </button>
                </form>
                <div className="mt-4 text-center text-sm">
                    <a href="/login" className="text-blue-600 hover:underline">Back to login</a>
                </div>
            </div>
        </div>
    );
}
