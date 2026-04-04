import { useEffect, useState } from 'react';
import { Client } from '../lib/api';

export function VerifyEmailPage() {
    const [status, setStatus] = useState<'verifying' | 'verified' | 'error'>('verifying');
    const [message, setMessage] = useState('Verifying your email...');

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const token = params.get('token');

        if (!token) {
            setStatus('error');
            setMessage('Verification token is missing.');
            return;
        }

        Client.post('/auth/verify-email', { token })
            .then((res) => {
                setStatus('verified');
                setMessage(res.message || 'Email verified. You can now sign in.');
            })
            .catch((err: any) => {
                setStatus('error');
                setMessage(err.message || 'Verification failed');
            });
    }, []);

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
            <div className="bg-white p-8 rounded shadow-md w-full max-w-md text-center">
                <h1 className="text-2xl font-bold mb-4">
                    {status === 'verifying' ? 'Verifying Email' : status === 'verified' ? 'Email Verified' : 'Verification Failed'}
                </h1>
                <p className="text-gray-700 mb-6">{message}</p>
                <a href="/login" className="inline-block bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
                    Go To Login
                </a>
            </div>
        </div>
    );
}
