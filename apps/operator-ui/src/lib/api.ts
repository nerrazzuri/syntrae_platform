/// <reference types="vite/client" />

// In production, we talk to separate subdomain. In dev, we use Vite proxy.
const IS_PROD = import.meta.env.PROD;
export const API_BASE = IS_PROD ? 'https://api.syntrae.ai' : '/api';

export class Client {

    static async request(endpoint: string, options: RequestInit = {}) {
        const headers = new Headers(options.headers);
        headers.set('Content-Type', 'application/json');

        const res = await fetch(`${API_BASE}${endpoint}`, {
            ...options,
            headers,
            credentials: 'include' // CRITICAL for Cookies
        });

        if (res.status === 401) {
            // Unauth - verify if it's not the login page or signup page
            const path = window.location.pathname;
            if (!path.includes('/login') && !path.includes('/signup')) {
                window.location.href = '/login';
            }
        }

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || err.message || 'API Error');
        }

        return res.json();
    }

    static get(endpoint: string) {
        return this.request(endpoint, { method: 'GET' });
    }

    static post(endpoint: string, body: any) {
        return this.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(body)
        });
    }

    static put(endpoint: string, body: any) {
        return this.request(endpoint, {
            method: 'PUT',
            body: JSON.stringify(body)
        });
    }

    // No setToken/getToken needed anymore
}
