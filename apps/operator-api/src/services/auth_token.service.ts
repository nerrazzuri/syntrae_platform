import crypto from 'crypto';
import { prisma } from '../db';
import type { Prisma } from '@syntrae/prisma-schema';

export const AUTH_TOKEN_TYPES = {
    EMAIL_VERIFICATION: 'EMAIL_VERIFICATION',
    PASSWORD_RESET: 'PASSWORD_RESET',
} as const;

type AuthTokenType = (typeof AUTH_TOKEN_TYPES)[keyof typeof AUTH_TOKEN_TYPES];

export class AuthTokenService {
    static async issue(userId: string, tokenType: AuthTokenType, expiresInMinutes: number, metadata?: Prisma.InputJsonValue) {
        await prisma.userActionToken.updateMany({
            where: {
                user_id: userId,
                token_type: tokenType,
                consumed_at: null,
            },
            data: {
                consumed_at: new Date(),
            },
        });

        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = this.hash(rawToken);
        const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000);

        await prisma.userActionToken.create({
            data: {
                user_id: userId,
                token_hash: tokenHash,
                token_type: tokenType,
                expires_at: expiresAt,
                metadata: metadata ?? {},
            },
        });

        return {
            token: rawToken,
            expiresAt,
        };
    }

    static async consume(rawToken: string, tokenType: AuthTokenType) {
        const tokenHash = this.hash(rawToken);
        const now = new Date();

        const token = await prisma.userActionToken.findFirst({
            where: {
                token_hash: tokenHash,
                token_type: tokenType,
                consumed_at: null,
                expires_at: { gt: now },
            },
            include: {
                user: true,
            },
        });

        if (!token) return null;

        await prisma.userActionToken.update({
            where: { id: token.id },
            data: { consumed_at: now },
        });

        return token;
    }

    static async findActiveByUser(userId: string, tokenType: AuthTokenType) {
        return prisma.userActionToken.findFirst({
            where: {
                user_id: userId,
                token_type: tokenType,
                consumed_at: null,
                expires_at: { gt: new Date() },
            },
            orderBy: { created_at: 'desc' },
        });
    }

    private static hash(rawToken: string) {
        return crypto.createHash('sha256').update(rawToken).digest('hex');
    }
}
