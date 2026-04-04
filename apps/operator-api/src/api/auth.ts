import { Router } from 'express';
import { prisma } from '../db';
import { AuthService } from '../services/auth.service';
import { BootstrapService } from '../services/bootstrap.service';
import { requireAuth } from '../middleware/auth';
import { AuthTokenService, AUTH_TOKEN_TYPES } from '../services/auth_token.service';
import { EmailService } from '../services/email.service';

export const authRouter = Router();

const COOKIE_NAME = 'syntrae_session';
const IS_PROD = process.env.NODE_ENV === 'production';
const COOKIE_SECURE = (process.env.COOKIE_SECURE || '').toLowerCase() === 'true'
    ? true
    : (process.env.COOKIE_SECURE || '').toLowerCase() === 'false'
        ? false
        : IS_PROD;
const BETA_SIGNUP_ENABLED = (process.env.BETA_SIGNUP_ENABLED || 'false').toLowerCase() === 'true';
const BETA_SIGNUP_ALLOWLIST = new Set(
    (process.env.BETA_SIGNUP_ALLOWLIST || '')
        .split(',')
        .map(email => email.trim().toLowerCase())
        .filter(Boolean)
);
const EMAIL_VERIFICATION_EXPIRY_MINUTES = Number(process.env.EMAIL_VERIFICATION_EXPIRY_MINUTES || 24 * 60);
const PASSWORD_RESET_EXPIRY_MINUTES = Number(process.env.PASSWORD_RESET_EXPIRY_MINUTES || 60);

const COOKIE_OPTIONS: any = {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: IS_PROD ? 'lax' : 'lax',
    domain: process.env.COOKIE_DOMAIN,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
};

function isSignupAllowed(email: string) {
    if (!BETA_SIGNUP_ENABLED) return false;
    if (BETA_SIGNUP_ALLOWLIST.size === 0) return true;
    return BETA_SIGNUP_ALLOWLIST.has(email.trim().toLowerCase());
}

function authContextPayload(user: { email_verified_at: Date | null }) {
    return {
        email_verified: Boolean(user.email_verified_at),
        ...EmailService.getTrustLinks(),
    };
}

authRouter.get('/trust-links', (_req, res) => {
    res.json(EmailService.getTrustLinks());
});

authRouter.post('/signup', async (req, res) => {
    try {
        const { email, password, workspace_name } = req.body;

        if (!email || !password || !workspace_name) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (!isSignupAllowed(email)) {
            return res.status(403).json({ error: 'Signup is closed for this beta cohort' });
        }

        const { user, account } = await BootstrapService.bootstrapAccount(
            email,
            password,
            workspace_name,
            { createSession: false }
        );

        const verification = await AuthTokenService.issue(
            user.id,
            AUTH_TOKEN_TYPES.EMAIL_VERIFICATION,
            EMAIL_VERIFICATION_EXPIRY_MINUTES,
            { workspace_id: account.id }
        );

        await prisma.user.update({
            where: { id: user.id },
            data: { verification_email_sent_at: new Date() },
        });

        const delivery = await EmailService.sendVerificationEmail(user.email, verification.token, account.name);

        return res.json({
            status: 'verification_required',
            message: 'Check your inbox to verify your email before signing in.',
            email: user.email,
            delivery,
            ...EmailService.getTrustLinks(),
        });
    } catch (error: any) {
        console.error('Signup Error:', error);
        if (error.message === 'User already exists') {
            return res.status(409).json({ error: 'User already exists' });
        }
        return res.status(500).json({ error: 'Internal Server Error' });
    }
});

authRouter.post('/resend-verification', async (req, res) => {
    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const user = await prisma.user.findUnique({
            where: { email },
            include: {
                memberships: {
                    where: { status: 'ACTIVE' },
                    include: { account: true },
                    take: 1,
                },
            },
        });

        if (!user) {
            return res.json({
                status: 'ok',
                message: 'If that email exists, a verification email has been sent.',
            });
        }

        if (user.email_verified_at) {
            return res.status(409).json({ error: 'Email is already verified', code: 'EMAIL_ALREADY_VERIFIED' });
        }

        const workspaceName = user.memberships[0]?.account?.name || 'Syntrae';
        const verification = await AuthTokenService.issue(
            user.id,
            AUTH_TOKEN_TYPES.EMAIL_VERIFICATION,
            EMAIL_VERIFICATION_EXPIRY_MINUTES
        );

        await prisma.user.update({
            where: { id: user.id },
            data: { verification_email_sent_at: new Date() },
        });

        const delivery = await EmailService.sendVerificationEmail(user.email, verification.token, workspaceName);

        return res.json({
            status: 'verification_required',
            message: 'Verification email sent.',
            delivery,
            ...EmailService.getTrustLinks(),
        });
    } catch (error) {
        console.error('Resend Verification Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
});

authRouter.post('/verify-email', async (req, res) => {
    try {
        const token = String(req.body?.token || '').trim();
        if (!token) {
            return res.status(400).json({ error: 'Verification token is required' });
        }

        const record = await AuthTokenService.consume(token, AUTH_TOKEN_TYPES.EMAIL_VERIFICATION);
        if (!record) {
            return res.status(400).json({ error: 'Verification link is invalid or expired', code: 'INVALID_TOKEN' });
        }

        await prisma.user.update({
            where: { id: record.user_id },
            data: {
                email_verified_at: new Date(),
                verification_email_sent_at: new Date(),
                status: 'ACTIVE',
            },
        });

        return res.json({
            status: 'verified',
            message: 'Email verified. You can now sign in.',
        });
    } catch (error) {
        console.error('Verify Email Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
});

authRouter.post('/forgot-password', async (req, res) => {
    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (user?.email_verified_at) {
            const reset = await AuthTokenService.issue(user.id, AUTH_TOKEN_TYPES.PASSWORD_RESET, PASSWORD_RESET_EXPIRY_MINUTES);
            await EmailService.sendPasswordResetEmail(user.email, reset.token);
        }

        return res.json({
            status: 'ok',
            message: 'If that account exists, a password reset email has been sent.',
        });
    } catch (error) {
        console.error('Forgot Password Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
});

authRouter.post('/reset-password', async (req, res) => {
    try {
        const token = String(req.body?.token || '').trim();
        const password = String(req.body?.password || '');
        if (!token || !password) {
            return res.status(400).json({ error: 'Token and password are required' });
        }
        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters long' });
        }

        const record = await AuthTokenService.consume(token, AUTH_TOKEN_TYPES.PASSWORD_RESET);
        if (!record) {
            return res.status(400).json({ error: 'Password reset link is invalid or expired', code: 'INVALID_TOKEN' });
        }

        const passwordHash = await AuthService.hashPassword(password);
        await prisma.user.update({
            where: { id: record.user_id },
            data: {
                password_hash: passwordHash,
                login_attempts: 0,
                locked_until: null,
            },
        });

        await prisma.session.deleteMany({ where: { user_id: record.user_id } });

        return res.json({
            status: 'password_reset',
            message: 'Password updated. You can now sign in.',
        });
    } catch (error) {
        console.error('Reset Password Error:', error);
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

        if (await AuthService.isLocked(normalizedEmail)) {
            return res.status(429).json({ error: 'Account temporarily locked due to failed attempts.' });
        }

        const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (!user) {
            await AuthService.recordLoginAttempt(normalizedEmail, false);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        if (!user.email_verified_at) {
            return res.status(403).json({
                error: 'Email verification required before login.',
                code: 'EMAIL_VERIFICATION_REQUIRED',
                email: user.email,
                ...authContextPayload(user),
            });
        }

        const isValid = await AuthService.verifyPassword(password, user.password_hash);
        await AuthService.recordLoginAttempt(normalizedEmail, isValid);

        if (!isValid) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        let workspaceId = '';
        const lastSession = await prisma.session.findFirst({
            where: { user_id: user.id },
            orderBy: { created_at: 'desc' }
        });

        if (lastSession?.active_workspace_id) {
            workspaceId = lastSession.active_workspace_id;
        } else {
            const membership = await prisma.workspaceMembership.findFirst({
                where: { user_id: user.id, status: 'ACTIVE' }
            });
            if (membership) workspaceId = membership.workspace_id;
        }

        if (!workspaceId) {
            return res.status(403).json({ error: 'No active workspace found for user.' });
        }

        const session = await AuthService.createSession(user.id, workspaceId);
        const account = await prisma.account.findUnique({ where: { id: workspaceId } });
        const defaultBrand = await prisma.brand.findFirst({ where: { workspace_id: workspaceId } });

        res.cookie(COOKIE_NAME, session.id, COOKIE_OPTIONS);

        return res.json({
            user: { id: user.id, email: user.email, email_verified: true },
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
        const workspace = await prisma.account.findUnique({ where: { id: session.active_workspace_id! } });

        if (!workspace) return res.status(404).json({ error: 'Active workspace not found' });

        const brands = await prisma.brand.findMany({
            where: { workspace_id: workspace.id, status: 'ACTIVE' },
            select: { id: true, name: true, domain: true }
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
            user: {
                id: user.id,
                email: user.email,
                email_verified: Boolean((user as any).email_verified_at),
            },
            active_workspace: workspace,
            brands,
            owner_settings: ownerSettings,
            role: membership?.role,
            ...EmailService.getTrustLinks(),
        });

    } catch (error) {
        console.error('Me Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
