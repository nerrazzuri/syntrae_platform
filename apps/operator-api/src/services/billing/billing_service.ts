import { prisma } from '../../db';

export class BillingService {

    static async upgradeToPro(accountId: string) {
        return prisma.$transaction(async (tx) => {
            // 1. Update Plan
            const account = await tx.account.update({
                where: { id: accountId },
                data: {
                    plan_id: 'PRO',
                    status: 'ACTIVE' // Clear any pending states
                }
            });

            // 2. Unpause all brands (User instruction)
            await tx.brand.updateMany({
                where: { workspace_id: accountId },
                data: { status: 'ACTIVE' }
            });

            return account;
        });
    }

    static async downgradeToFree(accountId: string) {
        // 1. Check Brand Count
        const brandCount = await prisma.brand.count({
            where: { workspace_id: accountId }
        });

        const FREE_LIMIT = 1;

        if (brandCount <= FREE_LIMIT) {
            // Safe to downgrade immediately
            return prisma.account.update({
                where: { id: accountId },
                data: { plan_id: 'FREE' }
            });
        } else {
            // Must enter Downgrade Selection Mode
            return prisma.account.update({
                where: { id: accountId },
                data: { status: 'PENDING_DOWNGRADE' }
            });
        }
    }

    static async resolveDowngrade(accountId: string, keepBrandId: string) {
        return prisma.$transaction(async (tx) => {
            // 1. Verify Ownership of kept brand
            const brand = await tx.brand.findFirst({
                where: { id: keepBrandId, workspace_id: accountId }
            });
            if (!brand) throw new Error('Brand not found');

            // 2. Pause ALL other brands
            await tx.brand.updateMany({
                where: {
                    workspace_id: accountId,
                    id: { not: keepBrandId }
                },
                data: { status: 'PAUSED' }
            });

            // 3. Ensure kept brand is ACTIVE
            await tx.brand.update({
                where: { id: keepBrandId },
                data: { status: 'ACTIVE' }
            });

            // 4. Finalize Downgrade
            return tx.account.update({
                where: { id: accountId },
                data: {
                    plan_id: 'FREE',
                    status: 'ACTIVE'
                }
            });
        });
    }
}
