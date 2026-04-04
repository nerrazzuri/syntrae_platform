import { NextFunction, Request, Response } from 'express';
import { AdminUser } from '@syntrae/prisma-schema';
import { AdminAuthService } from '../services/admin_auth.service';

declare global {
    namespace Express {
        interface Request {
            admin?: AdminUser;
        }
    }
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
    const token = String(req.headers['x-admin-token'] || '').trim();
    if (!token) {
        return res.status(401).json({ error: 'Admin session required' });
    }

    try {
        const admin = await AdminAuthService.validateSession(token);
        if (!admin) {
            return res.status(401).json({ error: 'Invalid or expired admin session' });
        }

        req.admin = admin;
        next();
    } catch (error) {
        console.error('[AdminAuth] Validation failed:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}
