const API_BASE = import.meta.env.VITE_ADMIN_API_BASE_URL || 'https://api.syntraeai.com/admin';
const TOKEN_KEY = 'syntrae_admin_token';

export function getAdminToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setAdminToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAdminToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function adminRequest(path: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  const token = getAdminToken();
  if (token) headers.set('x-admin-token', token);

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    clearAdminToken();
    throw new Error('Admin session expired');
  }

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || 'Request failed');
  }

  return res.json();
}
