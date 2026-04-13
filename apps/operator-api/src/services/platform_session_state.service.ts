import { promises as fs } from 'fs';
import path from 'path';

function storageRoot() {
    return process.env.AUTOMATION_STORAGE_ROOT || '/data/storage';
}

export interface BrowserCookieInput {
    name: string;
    value: string;
    domain?: string;
    path?: string;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: string;
    expirationDate?: number | null;
}

const REQUIRED_COOKIE_NAMES = ['web_session'];
const AUTH_COOKIE_NAMES = ['a1', 'id_token', 'web_session'];
const DISCOVERY_COOKIE_DOMAIN = 'xiaohongshu.com';
const ALLOWED_COOKIE_NAMES = new Set([
    'a1',
    'webId',
    'id_token',
    'web_session',
    'web_session_sec',
    'web_session_sig',
    'websectiga',
    'sec_poison_id',
    'gid',
    'abRequestId',
    'xsecappid',
    'webBuild',
    'loadts',
    'unread',
]);

function normalizeSameSite(value?: string) {
    const normalized = String(value || '').toLowerCase();
    if (normalized === 'strict') return 'Strict';
    if (normalized === 'lax') return 'Lax';
    return 'None';
}

export function normalizeSessionPlatform(platform: string) {
    const normalized = String(platform || '').trim().toLowerCase();
    if (normalized === 'rednote' || normalized === 'xiaohongshu' || normalized === 'xhs') {
        return 'rednote';
    }
    return normalized || 'rednote';
}

export class PlatformSessionStateService {
    static getScopedSessionPath(workspaceId: string, brandId: string, platform: string) {
        return path.join(storageRoot(), 'sessions', workspaceId, brandId, normalizeSessionPlatform(platform), 'session.json');
    }

    static sanitizeCookies(cookies: BrowserCookieInput[]) {
        const filtered = cookies
            .filter((cookie) => cookie && typeof cookie.name === 'string' && typeof cookie.value === 'string')
            .filter((cookie) => ALLOWED_COOKIE_NAMES.has(cookie.name))
            .map((cookie) => ({
                name: cookie.name,
                value: cookie.value,
                domain: cookie.domain || '.xiaohongshu.com',
                path: cookie.path || '/',
                httpOnly: Boolean(cookie.httpOnly),
                secure: cookie.secure !== false,
                sameSite: normalizeSameSite(cookie.sameSite),
                expires: typeof cookie.expirationDate === 'number' ? cookie.expirationDate : -1,
            }));

        const deduped = Array.from(new Map(filtered.map((cookie) => [`${cookie.name}:${cookie.domain}:${cookie.path}`, cookie])).values());
        return deduped;
    }

    static validateCookies(cookies: BrowserCookieInput[]) {
        const sanitized = this.sanitizeCookies(cookies);
        const presentNames = new Set(sanitized.map((cookie) => cookie.name));
        const missing = REQUIRED_COOKIE_NAMES.filter((name) => !presentNames.has(name));
        const hasAuthCookie = AUTH_COOKIE_NAMES.some((name) => presentNames.has(name));
        if (!hasAuthCookie) {
            missing.push('a1|id_token|web_session');
        }
        const hasDiscoveryWebSession = sanitized.some((cookie) => {
            const domain = String(cookie.domain || '').replace(/^\./, '').toLowerCase();
            return cookie.name === 'web_session' && domain.endsWith(DISCOVERY_COOKIE_DOMAIN);
        });
        if (!hasDiscoveryWebSession) {
            missing.push('web_session@xiaohongshu.com');
        }
        const hasDiscoveryA1 = sanitized.some((cookie) => {
            const domain = String(cookie.domain || '').replace(/^\./, '').toLowerCase();
            return cookie.name === 'a1' && domain.endsWith(DISCOVERY_COOKIE_DOMAIN);
        });
        if (!hasDiscoveryA1) {
            missing.push('a1@xiaohongshu.com');
        }

        return {
            ok: missing.length === 0,
            missing,
            sanitized,
        };
    }

    static async writeStorageState(workspaceId: string, brandId: string, platform: string, cookies: BrowserCookieInput[]) {
        const targetPath = this.getScopedSessionPath(workspaceId, brandId, platform);
        await fs.mkdir(path.dirname(targetPath), { recursive: true });

        const state = {
            cookies: this.sanitizeCookies(cookies),
            origins: [],
        };

        await fs.writeFile(targetPath, JSON.stringify(state, null, 2), 'utf8');
        return targetPath;
    }

    static async removeStorageState(workspaceId: string, brandId: string, platform: string) {
        const targetPath = this.getScopedSessionPath(workspaceId, brandId, platform);
        try {
            await fs.unlink(targetPath);
        } catch {
            return;
        }
    }
}
