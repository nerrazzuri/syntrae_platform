import { prisma, Prisma } from '../db';
import { AuthService } from './auth.service';
import { User, Account, Session, Brand } from '@syntrae/prisma-schema';
import { PLAN_CODES } from '@syntrae/commercial-plans';

export class BootstrapService {

    /**
     * Creates a new User, Workspace, Membership, Default Brand, Settings, and Session
     * in a single atomic transaction.
     */
    static async bootstrapAccount(
        email: string,
        passwordPlain: string,
        workspaceName: string,
        options?: { createSession?: boolean }
    ): Promise<{ session: Session | null, user: User, account: Account, brand: Brand }> {

        const normalizedEmail = email.trim().toLowerCase();

        // 1. Pre-validation checks (optional, good for UX error messages)
        const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (existingUser) {
            throw new Error('User already exists');
        }

        const passwordHash = await AuthService.hashPassword(passwordPlain);

        // 2. Transactional Creation
        return await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            // A. Create User
            const user = await tx.user.create({
                data: {
                    email: normalizedEmail,
                    password_hash: passwordHash,
                    status: 'ACTIVE'
                }
            });

            // B. Create Account (Workspace)
            const account = await tx.account.create({
                data: {
                    name: workspaceName,
                    status: 'ACTIVE',
                    plan_id: PLAN_CODES.STARTER,
                    onboarding_state: 'CREATED'
                }
            });

            // C. Create Membership (OWNER)
            await tx.workspaceMembership.create({
                data: {
                    user_id: user.id,
                    workspace_id: account.id,
                    role: 'OWNER',
                    status: 'ACTIVE'
                }
            });

            // D. Create Owner Settings
            await tx.ownerSettings.create({
                data: {
                    workspace_id: account.id,
                    mode: 'SUGGEST',
                    max_suggestions_per_day: 20, // Free tier default
                    max_suggestions_per_video: 2,
                    automation_opt_in: false,
                    platforms_enabled: '[]'
                }
            });

            await tx.workspaceSubscription.create({
                data: {
                    workspace_id: account.id,
                    plan_code: PLAN_CODES.STARTER,
                    display_name: 'Starter',
                    status: 'ACTIVE',
                    billing_interval: 'MONTHLY',
                }
            });

            // E. Create Default Brand
            const brand = await tx.brand.create({
                data: {
                    workspace_id: account.id,
                    name: 'Default Brand', // Or use workspaceName? Keeping distinct for clarity.
                    domain: 'general',
                    domain_context: {}, // Empty JSON
                    status: 'ACTIVE'
                }
            });

            // F. Create Session
            // Note: We cannot rely on AuthService.createSession here because we need to be INSIDE the transaction tx.
            // So we replicate the simple create logic using `tx`.
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 7); // 7 Days

            const session = options?.createSession === false
                ? null
                : await tx.session.create({
                    data: {
                        user_id: user.id,
                        active_workspace_id: account.id,
                        expires_at: expiresAt
                    },
                    include: {
                        user: true,
                        active_workspace: true
                    }
                });

            return { session, user, account, brand };
        });
    }
}
