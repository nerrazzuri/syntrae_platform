import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { Session, User } from '@syntrae/prisma-schema'; // Adjust import if needed

// Extend Request type to include user and session
declare global {
    namespace Express {
        interface Request {
            user?: User;
            session?: Session;
        }
    }
}

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
    // 1. Get Session ID from Cookie
    const sessionId = req.cookies['syntrae_session']; // Ensure cookie parser is used!

    if (!sessionId) {
        return res.status(401).json({ error: 'Unauthorized: No session cookie' });
    }

    // 2. Validate Session
    const session = await AuthService.getSession(sessionId);

    if (!session) {
        // Invalid or expired session
        res.clearCookie('syntrae_session');
        return res.status(401).json({ error: 'Unauthorized: Invalid session' });
    }

    // 3. Attach Context
    // AuthService.getSession includes user, but type check needs to be safe
    // @ts-ignore - session.user is included
    req.user = session.user;
    req.session = session;

    next();
};
