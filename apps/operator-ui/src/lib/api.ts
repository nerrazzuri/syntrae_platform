
/// <reference types="vite/client" />

const IS_PROD = import.meta.env.PROD;
const ENV_API_URL = import.meta.env.VITE_API_BASE_URL;

function resolveApiBase() {
    if (ENV_API_URL) return ENV_API_URL;
    const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
    const isLocalHost = hostname === 'localhost' || hostname.endsWith('.localhost.com');
    if (isLocalHost) return '/api';
    return IS_PROD ? 'https://api.syntraeai.com' : '/api';
}

export const API_BASE = resolveApiBase();

export class Client {

    static async request(endpoint: string, options: RequestInit = {}) {
        const headers = new Headers(options.headers);
        if (!(options.body instanceof FormData)) {
            headers.set('Content-Type', 'application/json');
        }

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

    static patch(endpoint: string, body: any) {
        return this.request(endpoint, {
            method: 'PATCH',
            body: JSON.stringify(body)
        });
    }

    static delete(endpoint: string) {
        return this.request(endpoint, {
            method: 'DELETE',
        });
    }

    static upload(endpoint: string, body: FormData) {
        return this.request(endpoint, {
            method: 'POST',
            body,
        });
    }
}

export class Api extends Client {
    static analytics = {
        getOverview: (params?: { from?: string, to?: string }) => {
            const query = new URLSearchParams(params).toString();
            return Client.get(`/analytics/overview?${query}`);
        },
        getBrands: (params?: { from?: string, to?: string }) => {
            const query = new URLSearchParams(params).toString();
            return Client.get(`/analytics/brands?${query}`);
        },
        getUsage: () => Client.get('/analytics/usage')
    };
}

export const api = Api;
