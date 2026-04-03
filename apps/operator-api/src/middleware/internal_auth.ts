import { Request, Response, NextFunction } from 'express';

export const requireInternalSecret = (req: Request, res: Response, next: NextFunction) => {
    // WF-1: Strict Internal Secret Auth
    // Case-insensitive header check
    const secretValues = [req.headers['x-internal-secret'], req.headers['x_internal_secret']];
    // Find first defined value
    const providedSecret = secretValues.find(val => val !== undefined) as string | undefined;

    const expectedSecret = process.env.AI_CORE_INTERNAL_SECRET;

    if (!expectedSecret) {
        console.error("FATAL: AI_CORE_INTERNAL_SECRET not set in environment.");
        return res.status(500).json({ error: "Internal Configuration Error" });
    }

    if (providedSecret && providedSecret === expectedSecret) {
        return next();
    }

    return res.status(403).json({ error: "Forbidden: Invalid Internal Secret" });
};
