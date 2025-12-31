import { Router } from 'express';
import { AuthService } from '../services/auth.service';
import { BootstrapService } from '../services/bootstrap.service';
import { requireAuth } from '../middleware/auth';
import { prisma } from '../index';

export const authRouter = Router();

// Cookie Configuration
const COOKIE_NAME = 'syntrae_session';
const IS_PROD = process.env.NODE_ENV === 'production';

const COOKIE_OPTIONS: any = {
    httpOnly: true,
    secure: IS_PROD, // Secure in Prod
    sameSite: IS_PROD ? 'lax' : 'lax',
    domain: process.env.COOKIE_DOMAIN, // e.g., '.syntraeai.com'
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
};

authRouter.post('/signup', async (req, res) => {
    try {
        const { email, password, workspace_name } = req.body;

        if (!email || !password || !workspace_name) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Bootstrap Account (Transactional)
        const { session, user, account, brand } = await BootstrapService.bootstrapAccount(
            email,
            password,
            workspace_name
        );

        // Set Cookie
        res.cookie(COOKIE_NAME, session.id, COOKIE_OPTIONS);

        // Return Context
        return res.json({
            user: { id: user.id, email: user.email },
            workspace: { id: account.id, name: account.name, plan_id: account.plan_id },
            active_brand: { id: brand.id, name: brand.name }
        });

    } catch (error: any) {
        console.error('Signup Error:', error);
        if (error.message === 'User already exists') {
            return res.status(409).json({ error: 'User already exists' });
        }
        return res.status(500).json({ error: 'Internal Server Error' });
    }
});

authRouter.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Missing credentials' });
        }

        const normalizedEmail = email.trim().toLowerCase();

        // 1. Check Lockout
        if (await AuthService.isLocked(normalizedEmail)) {
            return res.status(429).json({ error: 'Account temporarily locked due to failed attempts.' });
        }

        // 2. Find User
        const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (!user) {
            // Fake Verify to prevent timing attacks (optional but good practice)
            // await AuthService.verifyPassword('dummy', 'dummyhash');
            await AuthService.recordLoginAttempt(normalizedEmail, false); // This might create a phantom record? No, recordLogin checks existence safely. 
            // Actually AuthService.recordLoginAttempt checks user existence internally.
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // 3. Verify Password
        const isValid = await AuthService.verifyPassword(password, user.password_hash);
        await AuthService.recordLoginAttempt(normalizedEmail, isValid);

        if (!isValid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // 4. Create Session
        // Resolve active workspace - find last one or first membership
        let workspaceId = '';
        const lastSession = await prisma.session.findFirst({
            where: { user_id: user.id },
            orderBy: { created_at: 'desc' }
        });

        if (lastSession?.active_workspace_id) {
            workspaceId = lastSession.active_workspace_id;
        } else {
            // Fallback to first membership
            const membership = await prisma.workspaceMembership.findFirst({
                where: { user_id: user.id, status: 'ACTIVE' }
            });
            if (membership) workspaceId = membership.workspace_id;
        }

        // If still no workspace, create one? No, user has no workspace. Should not happen for Bootstrapped users.
        // But for invited users, they should have membership.
        if (!workspaceId) {
            return res.status(403).json({ error: 'No active workspace found for user.' });
        }

        const session = await AuthService.createSession(user.id, workspaceId);

        // 5. Fetch Data for Response
        const account = await prisma.account.findUnique({ where: { id: workspaceId } });
        const defaultBrand = await prisma.brand.findFirst({ where: { workspace_id: workspaceId } }); // Simplification for MVP

        // Set Cookie
        res.cookie(COOKIE_NAME, session.id, COOKIE_OPTIONS);

        return res.json({
            user: { id: user.id, email: user.email },
            workspace: account ? { id: account.id, name: account.name, plan_id: account.plan_id } : null,
            active_brand: defaultBrand ? { id: defaultBrand.id, name: defaultBrand.name } : null
        });

    } catch (error) {
        console.error('Login Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
});

authRouter.post('/logout', async (req, res) => {
    const sessionId = req.cookies[COOKIE_NAME];
    if (sessionId) {
        await AuthService.deleteSession(sessionId);
    }
    res.clearCookie(COOKIE_NAME, { ...COOKIE_OPTIONS, maxAge: 0 });
    res.json({ success: true });
});

authRouter.get('/me', requireAuth, async (req, res) => {
    try {
        const user = req.user!;
        const session = req.session!;

        // Fetch full context needed for Bootstrap
        // - Active Workspace
        // - All User Memberships? (Maybe later)
        // - Brands of Active Workspace
        // - Owner Settings of Active Workspace

        const workspace = await prisma.account.findUnique({ where: { id: session.active_workspace_id! } });

        if (!workspace) return res.status(404).json({ error: 'Active workspace not found' });

        const brands = await prisma.brand.findMany({
            where: { workspace_id: workspace.id, status: 'ACTIVE' },
            select: { id: true, name: true, domain: true } // Minimal fields
        });

        const ownerSettings = await prisma.ownerSettings.findUnique({
            where: { workspace_id: workspace.id }
        });

        const membership = await prisma.workspaceMembership.findUnique({
            where: {
                workspace_id_user_id: {
                    workspace_id: workspace.id,
                    user_id: user.id
                }
            }
        });

        res.json({
            user: { id: user.id, email: user.email },
            active_workspace: workspace,
            brands: brands,
            owner_settings: ownerSettings,
            role: membership?.role
        });

    } catch (error) {
        console.error('Me Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
