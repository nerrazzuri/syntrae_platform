
/// <reference types="vite/client" />

// In production, we talk to separate subdomain. In dev, we use Vite proxy.
const IS_PROD = import.meta.env.PROD;
const ENV_API_URL = import.meta.env.VITE_API_BASE_URL;
export const API_BASE = ENV_API_URL || (IS_PROD ? 'https://api.syntraeai.com' : '/api');

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

    static patch(endpoint: string, body: any) {
        return this.request(endpoint, {
            method: 'PATCH',
            body: JSON.stringify(body)
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
