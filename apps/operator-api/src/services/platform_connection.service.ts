import { promises as fs } from 'fs';
import { randomBytes } from 'crypto';
import { prisma, Prisma } from '../db';
import { PlatformSessionCryptoService } from './platform_session_crypto.service';
import {
    BrowserCookieInput,
    PlatformSessionStateService,
    normalizeSessionPlatform,
} from './platform_session_state.service';

export type SupportedConnectionPlatform = 'rednote';

function normalizePlatform(platform: string): SupportedConnectionPlatform {
    const normalized = normalizeSessionPlatform(platform);
    if (normalized === 'rednote') {
        return 'rednote';
    }
    throw new Error(`Unsupported platform connection: ${platform}`);
}

function legacySessionPath(brandId: string, platform: SupportedConnectionPlatform) {
    return `/data/storage/sessions/${brandId}/${platform}/session.json`;
}

async function fileStatOrNull(targetPath: string | null) {
    if (!targetPath) return null;
    try {
        return await fs.stat(targetPath);
    } catch {
        return null;
    }
}

function parsePayload(connection: { encrypted_session_payload?: string | null } | null) {
    if (!connection?.encrypted_session_payload) return null;
    try {
        const decrypted = PlatformSessionCryptoService.decrypt(connection.encrypted_session_payload);
        return JSON.parse(decrypted);
    } catch {
        return null;
    }
}

function jsonObject(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

export class PlatformConnectionService {
    static async assertBrandAccess(workspaceId: string, brandId: string) {
        const brand = await prisma.brand.findFirst({
            where: { id: brandId, workspace_id: workspaceId },
            select: { id: true, workspace_id: true, name: true, domain: true },
        });

        if (!brand) {
            throw new Error('Brand not found or access denied');
        }

        return brand;
    }

    static buildLoginCommand(workspaceId: string, brandId: string, platform: SupportedConnectionPlatform) {
        return `docker compose exec automation-worker python video_detection_engine/main_automation.py login --platform ${platform} --brand-id ${brandId} --workspace-id ${workspaceId}`;
    }

    static async getConnection(workspaceId: string, brandId: string, platformInput: string) {
        const brand = await this.assertBrandAccess(workspaceId, brandId);
        const platform = normalizePlatform(platformInput);
        const preferredPath = PlatformSessionStateService.getScopedSessionPath(workspaceId, brandId, platform);
        const fallbackPath = legacySessionPath(brandId, platform);

        const [connection, preferredStat, fallbackStat] = await Promise.all([
            prisma.brandPlatformConnection.findUnique({
                where: { brand_id_platform: { brand_id: brandId, platform } },
            }),
            fileStatOrNull(preferredPath),
            fileStatOrNull(fallbackPath),
        ]);

        const decryptedPayload = parsePayload(connection);
        const detectedPath = preferredStat ? preferredPath : (fallbackStat ? fallbackPath : null);
        const detectedStat = preferredStat || fallbackStat;
        const now = new Date();
        const nextStatus = connection?.status === 'PENDING'
            ? 'PENDING'
            : detectedPath
                ? (connection?.verification_error ? 'RECONNECT_REQUIRED' : 'CONNECTED')
                : 'DISCONNECTED';

        const nextData: Prisma.BrandPlatformConnectionUncheckedCreateInput = {
            workspace_id: workspaceId,
            brand_id: brandId,
            platform,
            provider: connection?.provider || 'COOKIE_CAPTURE',
            auth_type: connection?.auth_type || 'COOKIE_BLOB',
            status: nextStatus,
            session_path: detectedPath ?? connection?.session_path ?? preferredPath,
            encrypted_session_payload: connection?.encrypted_session_payload ?? null,
            session_version: connection?.session_version ?? 1,
            session_updated_at: detectedStat?.mtime ?? connection?.session_updated_at ?? null,
            connected_at: detectedPath ? (connection?.connected_at ?? now) : null,
            last_checked_at: now,
            last_verified_at: connection?.last_verified_at ?? null,
            verification_error: connection?.verification_error ?? null,
            expires_at: connection?.expires_at ?? null,
            last_error: detectedPath ? null : connection?.last_error ?? null,
            metadata: {
                ...jsonObject(connection?.metadata),
                captured_cookie_names: Array.isArray(decryptedPayload?.cookies) ? decryptedPayload.cookies.map((cookie: any) => cookie.name) : [],
            },
        };

        const persisted = await prisma.brandPlatformConnection.upsert({
            where: { brand_id_platform: { brand_id: brandId, platform } },
            update: {
                provider: nextData.provider,
                auth_type: nextData.auth_type,
                status: nextData.status,
                session_path: nextData.session_path,
                encrypted_session_payload: nextData.encrypted_session_payload,
                session_version: nextData.session_version,
                session_updated_at: nextData.session_updated_at,
                connected_at: nextData.connected_at,
                last_checked_at: nextData.last_checked_at,
                last_verified_at: nextData.last_verified_at,
                verification_error: nextData.verification_error,
                expires_at: nextData.expires_at,
                last_error: nextData.last_error,
                metadata: nextData.metadata,
            },
            create: nextData,
        });

        return {
            ...persisted,
            brand_name: brand.name,
            session_present: Boolean(detectedPath),
            recommended_session_path: preferredPath,
            active_session_path: detectedPath ?? null,
            connect_command: this.buildLoginCommand(workspaceId, brandId, platform),
            extension_supported: true,
            extension_required_cookie_names: ['a1', 'web_session'],
            extension_instructions: [
                'Prepare a connection challenge from this page.',
                'Use the Syntrae XHS browser extension to capture your logged-in Xiaohongshu cookies.',
                'The extension uploads a brand-scoped session to Syntrae.',
                'Refresh or verify the connection once capture completes.',
            ],
        };
    }

    static async requestConnection(workspaceId: string, brandId: string, platformInput: string) {
        const platform = normalizePlatform(platformInput);
        const preferredPath = PlatformSessionStateService.getScopedSessionPath(workspaceId, brandId, platform);

        await this.assertBrandAccess(workspaceId, brandId);

        await prisma.brandPlatformConnection.upsert({
            where: { brand_id_platform: { brand_id: brandId, platform } },
            update: {
                status: 'PENDING',
                provider: 'COOKIE_CAPTURE',
                auth_type: 'COOKIE_BLOB',
                session_path: preferredPath,
                last_checked_at: new Date(),
                verification_error: null,
                last_error: null,
            },
            create: {
                workspace_id: workspaceId,
                brand_id: brandId,
                platform,
                provider: 'COOKIE_CAPTURE',
                auth_type: 'COOKIE_BLOB',
                status: 'PENDING',
                session_path: preferredPath,
                last_checked_at: new Date(),
                metadata: {},
            },
        });

        return this.getConnection(workspaceId, brandId, platform);
    }

    static async createChallenge(workspaceId: string, brandId: string, platformInput: string, userId: string) {
        const platform = normalizePlatform(platformInput);
        await this.assertBrandAccess(workspaceId, brandId);

        const nonce = cryptoRandom();
        const challenge = await prisma.platformConnectionChallenge.create({
            data: {
                workspace_id: workspaceId,
                brand_id: brandId,
                platform,
                nonce_hash: PlatformSessionCryptoService.hashNonce(nonce),
                expires_at: new Date(Date.now() + 5 * 60 * 1000),
                created_by_user_id: userId,
            },
        });

        await this.requestConnection(workspaceId, brandId, platform);

        return {
            challenge_id: challenge.id,
            nonce,
            expires_at: challenge.expires_at.toISOString(),
            brand_id: brandId,
            workspace_id: workspaceId,
            platform,
            ingest_path: `/platform-connections/${platform}/ingest`,
        };
    }

    static async ingestCookies(
        platformInput: string,
        challengeId: string,
        nonce: string,
        cookies: BrowserCookieInput[],
        userAgent?: string | null
    ) {
        const platform = normalizePlatform(platformInput);
        const challenge = await prisma.platformConnectionChallenge.findUnique({
            where: { id: challengeId },
        });

        if (!challenge || challenge.platform !== platform) {
            throw new Error('Invalid connection challenge');
        }
        if (challenge.used_at) {
            throw new Error('Connection challenge already used');
        }
        if (challenge.expires_at.getTime() <= Date.now()) {
            throw new Error('Connection challenge expired');
        }
        if (PlatformSessionCryptoService.hashNonce(nonce) !== challenge.nonce_hash) {
            throw new Error('Invalid connection challenge nonce');
        }

        const validation = PlatformSessionStateService.validateCookies(cookies);
        if (!validation.ok) {
            throw new Error(`Missing required cookies: ${validation.missing.join(', ')}`);
        }

        const payload = {
            platform,
            captured_at: new Date().toISOString(),
            user_agent: userAgent || null,
            cookies: validation.sanitized,
        };

        const sessionPath = await PlatformSessionStateService.writeStorageState(
            challenge.workspace_id,
            challenge.brand_id,
            platform,
            validation.sanitized
        );

        const now = new Date();
        await prisma.$transaction([
            prisma.brandPlatformConnection.upsert({
                where: { brand_id_platform: { brand_id: challenge.brand_id, platform } },
                update: {
                    provider: 'COOKIE_CAPTURE',
                    auth_type: 'COOKIE_BLOB',
                    status: 'CONNECTED',
                    session_path: sessionPath,
                    encrypted_session_payload: PlatformSessionCryptoService.encrypt(JSON.stringify(payload)),
                    session_version: 1,
                    session_updated_at: now,
                    connected_at: now,
                    last_checked_at: now,
                    last_verified_at: now,
                    verification_error: null,
                    last_error: null,
                    metadata: {
                        cookie_count: validation.sanitized.length,
                        captured_cookie_names: validation.sanitized.map((cookie) => cookie.name),
                        capture_method: 'EXTENSION',
                    },
                },
                create: {
                    workspace_id: challenge.workspace_id,
                    brand_id: challenge.brand_id,
                    platform,
                    provider: 'COOKIE_CAPTURE',
                    auth_type: 'COOKIE_BLOB',
                    status: 'CONNECTED',
                    session_path: sessionPath,
                    encrypted_session_payload: PlatformSessionCryptoService.encrypt(JSON.stringify(payload)),
                    session_version: 1,
                    session_updated_at: now,
                    connected_at: now,
                    last_checked_at: now,
                    last_verified_at: now,
                    metadata: {
                        cookie_count: validation.sanitized.length,
                        captured_cookie_names: validation.sanitized.map((cookie) => cookie.name),
                        capture_method: 'EXTENSION',
                    },
                },
            }),
            prisma.platformConnectionChallenge.update({
                where: { id: challenge.id },
                data: { used_at: now },
            }),
        ]);

        return this.getConnection(challenge.workspace_id, challenge.brand_id, platform);
    }

    static async verifyConnection(workspaceId: string, brandId: string, platformInput: string) {
        const platform = normalizePlatform(platformInput);
        await this.assertBrandAccess(workspaceId, brandId);

        const connection = await prisma.brandPlatformConnection.findUnique({
            where: { brand_id_platform: { brand_id: brandId, platform } },
        });

        if (!connection) {
            return this.getConnection(workspaceId, brandId, platform);
        }

        const payload = parsePayload(connection);
        const validation = PlatformSessionStateService.validateCookies(payload?.cookies || []);
        const sessionPath = PlatformSessionStateService.getScopedSessionPath(workspaceId, brandId, platform);
        const stat = await fileStatOrNull(sessionPath);

        const status = validation.ok && stat ? 'CONNECTED' : 'RECONNECT_REQUIRED';
        const verificationError = validation.ok && stat
            ? null
            : `Missing session state or required cookies (${validation.missing.join(', ') || 'session file missing'})`;

        await prisma.brandPlatformConnection.update({
            where: { brand_id_platform: { brand_id: brandId, platform } },
            data: {
                status,
                session_path: sessionPath,
                session_updated_at: stat?.mtime ?? connection.session_updated_at,
                last_checked_at: new Date(),
                last_verified_at: new Date(),
                verification_error: verificationError,
                last_error: verificationError,
            },
        });

        return this.getConnection(workspaceId, brandId, platform);
    }

    static async disconnect(workspaceId: string, brandId: string, platformInput: string) {
        const platform = normalizePlatform(platformInput);
        await this.assertBrandAccess(workspaceId, brandId);

        await PlatformSessionStateService.removeStorageState(workspaceId, brandId, platform);

        const now = new Date();
        await prisma.brandPlatformConnection.upsert({
            where: { brand_id_platform: { brand_id: brandId, platform } },
            update: {
                provider: 'COOKIE_CAPTURE',
                auth_type: 'COOKIE_BLOB',
                status: 'DISCONNECTED',
                session_path: PlatformSessionStateService.getScopedSessionPath(workspaceId, brandId, platform),
                encrypted_session_payload: null,
                session_updated_at: null,
                connected_at: null,
                last_checked_at: now,
                last_verified_at: null,
                verification_error: null,
                expires_at: null,
                last_error: null,
            },
            create: {
                workspace_id: workspaceId,
                brand_id: brandId,
                platform,
                provider: 'COOKIE_CAPTURE',
                auth_type: 'COOKIE_BLOB',
                status: 'DISCONNECTED',
                session_path: PlatformSessionStateService.getScopedSessionPath(workspaceId, brandId, platform),
                last_checked_at: now,
                metadata: {},
            },
        });

        return this.getConnection(workspaceId, brandId, platform);
    }
}

function cryptoRandom() {
    return randomBytes(24).toString('hex');
}
