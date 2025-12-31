import { prisma } from '../db';
import { PlanEnforcer } from './billing/plan_enforcer';

export class BrandService {
    static async createBrand(accountId: string, name: string, domain: string) {
        // 1. Enforce Plan Limits
        await PlanEnforcer.checkBrandLimit(accountId);

        // 2. Create
        return prisma.brand.create({
            data: {
                workspace_id: accountId,
                name,
                domain,
                domain_context: {}, // Empty init
                status: 'ACTIVE'
            }
        });
    }

    static async listBrands(accountId: string) {
        return prisma.brand.findMany({
            where: { workspace_id: accountId },
            orderBy: { created_at: 'desc' }
        });
    }

    static async setBrandStatus(accountId: string, brandId: string, status: 'ACTIVE' | 'PAUSED') {
        // Verify ownership
        const brand = await prisma.brand.findFirst({
            where: { id: brandId, workspace_id: accountId }
        });

        if (!brand) throw new Error('Brand not found or access denied');

        // If Activating, check limits?
        // If plan is FREE (1 limit), and we try to activate a 2nd brand while one is active?
        // Prompt says: "Free users limited to 1 Brand".
        // If I have 5 brands (downgraded), only 1 can be active.
        // So checking creation limit isn't enough. We need separate `canActivateBrand` check?
        // Or simpler: `checkActiveBrandLimit`.

        // Check Account Status
        const account = await prisma.account.findUnique({
            where: { id: accountId },
            select: { status: true }
        });

        if (status === 'ACTIVE') {
            if (account?.status === 'PENDING_DOWNGRADE') {
                throw new Error('Cannot activate brands while account is pending downgrade. Please resolve the downgrade first.');
            }

            const plan = await PlanEnforcer.getPlan(accountId);
            const activeCount = await prisma.brand.count({
                where: { workspace_id: accountId, status: 'ACTIVE', id: { not: brandId } }
            });

            if (activeCount >= plan.maxBrands) {
                throw new Error(`Cannot activate brand: Plan limit of ${plan.maxBrands} active brands reached.`);
            }
        }

        return prisma.brand.update({
            where: { id: brandId },
            data: { status }
        });
    }
}
