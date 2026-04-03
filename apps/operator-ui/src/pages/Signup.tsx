import React, { useState } from 'react';
import { Client } from '../lib/api';

export function Signup() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [workspaceName, setWorkspaceName] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            await Client.post('/auth/signup', {
                email,
                password,
                workspace_name: workspaceName
            });
            // Cookie set automatically by browser
            window.location.href = '/';
        } catch (err: any) {
            setError(err.message || 'Signup failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100">
            <div className="bg-white p-8 rounded shadow-md w-full max-w-md">
                <h1 className="text-2xl font-bold mb-6 text-center">Create Account</h1>
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
            </div>
        </div>
    );
}
