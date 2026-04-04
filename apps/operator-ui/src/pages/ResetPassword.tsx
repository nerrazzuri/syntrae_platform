import React, { useMemo, useState } from 'react';
import { Client } from '../lib/api';

export function ResetPasswordPage() {
    const token = useMemo(() => new URLSearchParams(window.location.search).get('token') || '', []);
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (!token) {
            setError('Reset token is missing.');
            return;
        }
        if (password.length < 8) {
            setError('Password must be at least 8 characters long.');
            return;
        }
        if (password !== confirmPassword) {
            setError('Passwords do not match.');
            return;
        }

        setLoading(true);
        try {
            const res = await Client.post('/auth/reset-password', { token, password });
            setMessage(res.message || 'Password updated. You can now sign in.');
        } catch (err: any) {
            setError(err.message || 'Password reset failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
            <div className="bg-white p-8 rounded shadow-md w-full max-w-md">
                <h1 className="text-2xl font-bold mb-2 text-center">Choose A New Password</h1>
                <p className="text-sm text-gray-600 text-center mb-6">
                    Set a new password for your Syntrae account.
                </p>
                {message && <div className="bg-green-100 text-green-800 p-3 mb-4 rounded">{message}</div>}
                {error && <div className="bg-red-100 text-red-700 p-3 mb-4 rounded">{error}</div>}
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium mb-1">New Password</label>
                        <input
                            type="password"
                            className="w-full p-2 border rounded"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                            minLength={8}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium mb-1">Confirm Password</label>
                        <input
                            type="password"
                            className="w-full p-2 border rounded"
                            value={confirmPassword}
                            onChange={e => setConfirmPassword(e.target.value)}
                            required
                            minLength={8}
                        />
                    </div>
                    <button type="submit" disabled={loading} className="w-full bg-blue-600 text-white p-2 rounded hover:bg-blue-700 disabled:opacity-50">
                        {loading ? 'Updating...' : 'Update Password'}
                    </button>
                </form>
                <div className="mt-4 text-center text-sm">
                    <a href="/login" className="text-blue-600 hover:underline">Back to login</a>
                </div>
            </div>
        </div>
    );
}
