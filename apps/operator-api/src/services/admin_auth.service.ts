import bcrypt from 'bcrypt';
import { prisma } from '../db';

const ADMIN_SESSION_TTL_HOURS = 24;

export class AdminAuthService {
    static async ensureBootstrapAdmin() {
        const email = String(process.env.ADMIN_BOOTSTRAP_EMAIL || '').trim().toLowerCase();
        const password = String(process.env.ADMIN_BOOTSTRAP_PASSWORD || '');

        if (!email || !password) return;

        const existing = await prisma.adminUser.findUnique({ where: { email } });
        if (existing) return;

        const passwordHash = await bcrypt.hash(password, 12);
        await prisma.adminUser.create({
            data: {
                email,
                password_hash: passwordHash,
                role: 'SUPERADMIN',
            }
        });
        console.log(`[AdminAuth] Bootstrap admin created: ${email}`);
    }

    static async login(email: string, password: string) {
        const admin = await prisma.adminUser.findUnique({
            where: { email: email.trim().toLowerCase() }
        });
        if (!admin) return null;

        const valid = await bcrypt.compare(password, admin.password_hash);
        if (!valid) return null;

        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + ADMIN_SESSION_TTL_HOURS);

        const session = await prisma.adminSession.create({
            data: {
                admin_id: admin.id,
                expires_at: expiresAt,
            }
        });

        return {
            token: session.id,
            admin,
            expires_at: expiresAt,
        };
    }

    static async validateSession(token: string) {
        const session = await prisma.adminSession.findUnique({
            where: { id: token },
            include: { admin: true }
        });
        if (!session) return null;

        if (session.expires_at < new Date()) {
            await prisma.adminSession.delete({ where: { id: token } }).catch(() => undefined);
            return null;
        }

        return session.admin;
    }

    static async logout(token: string) {
        await prisma.adminSession.delete({ where: { id: token } }).catch(() => undefined);
    }
}
