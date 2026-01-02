import bcrypt from 'bcrypt';
import { prisma } from '../db';
import { Session, User } from '@syntrae/prisma-schema';

const SALT_ROUNDS = 10;
const SESSION_DURATION_DAYS = 7;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 15;

export class AuthService {

    // Password Management
    static async hashPassword(password: string): Promise<string> {
        return bcrypt.hash(password, SALT_ROUNDS);
    }

    static async verifyPassword(password: string, hash: string): Promise<boolean> {
        return bcrypt.compare(password, hash);
    }

    // Session Management
    static async createSession(userId: string, workspaceId: string): Promise<Session> {
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + SESSION_DURATION_DAYS);

        return prisma.session.create({
            data: {
                user_id: userId,
                active_workspace_id: workspaceId,
                expires_at: expiresAt,
                last_seen_at: new Date()
            },
            include: {
                user: true,
                active_workspace: true
            }
        });
    }

    static async getSession(sessionId: string): Promise<Session | null> {
        const session = await prisma.session.findUnique({
            where: { id: sessionId },
            include: {
                user: true,
                active_workspace: true
            }
        });

        if (!session) return null;

        // Check expiry
        if (new Date() > session.expires_at) {
            await this.deleteSession(sessionId);
            return null;
        }

        // Extend session if nearing expiry (sliding window)
        // Simple implementation: Update last_seen_at on every verified access
        await prisma.session.update({
            where: { id: sessionId },
            data: { last_seen_at: new Date() }
        });

        return session;
    }

    static async deleteSession(sessionId: string): Promise<void> {
        await prisma.session.deleteMany({
            where: { id: sessionId }
        });
    }

    // Login Security
    static async recordLoginAttempt(email: string, success: boolean): Promise<void> {
        const normalizedEmail = email.toLowerCase();
        const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

        if (!user) return; // Don't leak user existence? Or maybe verify logic happens elsewhere.

        if (success) {
            await prisma.user.update({
                where: { id: user.id },
                data: {
                    login_attempts: 0,
                    locked_until: null,
                    last_login_at: new Date()
                }
            });
        } else {
            const attempts = user.login_attempts + 1;
            let lockedUntil = user.locked_until;

            if (attempts >= MAX_LOGIN_ATTEMPTS) {
                const lockTime = new Date();
                lockTime.setMinutes(lockTime.getMinutes() + LOCKOUT_DURATION_MINUTES);
                lockedUntil = lockTime;
            }

            await prisma.user.update({
                where: { id: user.id },
                data: {
                    login_attempts: attempts,
                    locked_until: lockedUntil
                }
            });
        }
    }

    static async isLocked(email: string): Promise<boolean> {
        const normalizedEmail = email.toLowerCase();
        const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (!user || !user.locked_until) return false;

        return new Date() < user.locked_until;
    }
}
