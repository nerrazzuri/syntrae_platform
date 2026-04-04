import { promises as fs } from 'fs';
import path from 'path';
import { prisma, Prisma } from '../db';

const STORAGE_ROOT = process.env.AUTOMATION_STORAGE_ROOT || '/data/storage';

export type SupportedConnectionPlatform = 'rednote';

function normalizePlatform(platform: string): SupportedConnectionPlatform {
    const normalized = platform.toLowerCase();
    if (normalized === 'rednote' || normalized === 'xiaohongshu' || normalized === 'xhs') {
        return 'rednote';
    }
    throw new Error(`Unsupported platform connection: ${platform}`);
}

function workspaceSessionPath(workspaceId: string, brandId: string, platform: SupportedConnectionPlatform) {
    return path.join(STORAGE_ROOT, 'sessions', workspaceId, brandId, platform, 'session.json');
}

function legacySessionPath(brandId: string, platform: SupportedConnectionPlatform) {
    return path.join(STORAGE_ROOT, 'sessions', brandId, platform, 'session.json');
}

async function fileStatOrNull(targetPath: string) {
    try {
        return await fs.stat(targetPath);
    } catch {
        return null;
    }
}

export class PlatformConnectionService {
    static async assertBrandAccess(workspaceId: string, brandId: string) {
        const brand = await prisma.brand.findFirst({
            where: { id: brandId, workspace_id: workspaceId },
            select: { id: true, workspace_id: true, name: true },
        });

        if (!brand) {
            throw new Error('Brand not found or access denied');
        }

        return brand;
    }

    static buildLoginCommand(workspaceId: string, brandId: string, platform: SupportedConnectionPlatform) {
        return `docker compose exec automation-worker python main_automation.py login --platform ${platform} --brand-id ${brandId} --workspace-id ${workspaceId}`;
    }

    static async getConnection(workspaceId: string, brandId: string, platformInput: string) {
        const brand = await this.assertBrandAccess(workspaceId, brandId);
        const platform = normalizePlatform(platformInput);
        const preferredPath = workspaceSessionPath(workspaceId, brandId, platform);
        const fallbackPath = legacySessionPath(brandId, platform);

        const [connection, preferredStat, fallbackStat] = await Promise.all([
            prisma.brandPlatformConnection.findUnique({
                where: { brand_id_platform: { brand_id: brandId, platform } },
            }),
            fileStatOrNull(preferredPath),
            fileStatOrNull(fallbackPath),
        ]);

        const detectedPath = preferredStat ? preferredPath : (fallbackStat ? fallbackPath : null);
        const detectedStat = preferredStat || fallbackStat;
        const now = new Date();
        const nextStatus = detectedPath
            ? 'CONNECTED'
            : (connection?.status === 'PENDING' ? 'PENDING' : 'DISCONNECTED');

        const nextData: Prisma.BrandPlatformConnectionUncheckedCreateInput = {
            workspace_id: workspaceId,
            brand_id: brandId,
            platform,
            provider: 'MANUAL_SESSION',
            status: nextStatus,
            session_path: detectedPath ?? connection?.session_path ?? preferredPath,
            session_updated_at: detectedStat?.mtime ?? null,
            connected_at: detectedPath ? (connection?.connected_at ?? now) : null,
            last_checked_at: now,
            last_error: detectedPath ? null : connection?.last_error ?? null,
            metadata: {},
        };

        const persisted = await prisma.brandPlatformConnection.upsert({
            where: { brand_id_platform: { brand_id: brandId, platform } },
            update: {
                status: nextData.status,
                session_path: nextData.session_path,
                session_updated_at: nextData.session_updated_at,
                connected_at: nextData.connected_at,
                last_checked_at: nextData.last_checked_at,
                last_error: nextData.last_error,
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
            instructions: [
                'Run the login command on the VPS from infra/compose.',
                'A headful browser will open inside the worker environment for manual XHS login.',
                'After login completes and you press ENTER, the brand-scoped session file will be saved.',
                'Return here and refresh the connection status.',
            ],
        };
    }

    static async requestConnection(workspaceId: string, brandId: string, platformInput: string) {
        const platform = normalizePlatform(platformInput);
        const preferredPath = workspaceSessionPath(workspaceId, brandId, platform);

        await this.assertBrandAccess(workspaceId, brandId);

        await prisma.brandPlatformConnection.upsert({
            where: { brand_id_platform: { brand_id: brandId, platform } },
            update: {
                status: 'PENDING',
                provider: 'MANUAL_SESSION',
                session_path: preferredPath,
                last_checked_at: new Date(),
                last_error: null,
            },
            create: {
                workspace_id: workspaceId,
                brand_id: brandId,
                platform,
                provider: 'MANUAL_SESSION',
                status: 'PENDING',
                session_path: preferredPath,
                last_checked_at: new Date(),
                metadata: {},
            },
        });

        return this.getConnection(workspaceId, brandId, platform);
    }

    static async disconnect(workspaceId: string, brandId: string, platformInput: string) {
        const platform = normalizePlatform(platformInput);
        await this.assertBrandAccess(workspaceId, brandId);

        const preferredPath = workspaceSessionPath(workspaceId, brandId, platform);
        const fallbackPath = legacySessionPath(brandId, platform);

        await Promise.all([preferredPath, fallbackPath].map(async (targetPath) => {
            try {
                await fs.unlink(targetPath);
            } catch {
                return;
            }
        }));

        const now = new Date();
        await prisma.brandPlatformConnection.upsert({
            where: { brand_id_platform: { brand_id: brandId, platform } },
            update: {
                status: 'DISCONNECTED',
                session_path: preferredPath,
                session_updated_at: null,
                connected_at: null,
                last_checked_at: now,
                last_error: null,
            },
            create: {
                workspace_id: workspaceId,
                brand_id: brandId,
                platform,
                provider: 'MANUAL_SESSION',
                status: 'DISCONNECTED',
                session_path: preferredPath,
                last_checked_at: now,
                metadata: {},
            },
        });

        return this.getConnection(workspaceId, brandId, platform);
    }
}
