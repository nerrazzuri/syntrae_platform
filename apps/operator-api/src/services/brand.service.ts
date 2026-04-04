import { prisma } from '../db';
import { SubscriptionPolicyService } from './billing/subscription_policy.service';
import { BrandDefaultsService } from './brand_defaults.service';

export class BrandService {
    static async createBrand(accountId: string, name: string, domain: string) {
        await SubscriptionPolicyService.assertCanCreateAdditionalBrand(accountId);

        return prisma.$transaction(async (tx) => {
            const brand = await tx.brand.create({
                data: {
                    workspace_id: accountId,
                    name,
                    domain,
                    domain_context: {},
                    status: 'ACTIVE'
                }
            });

            await tx.automationPolicy.create({
                data: BrandDefaultsService.buildDefaultPolicyInput(brand.id, 1)
            });

            await tx.marketProfile.create({
                data: BrandDefaultsService.buildDefaultMarketProfileInput(brand.id, brand.name, brand.domain)
            });

            return brand;
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

        // Activation must respect the effective package's active-brand ceiling.
        // A downgraded workspace can retain paused brands, but cannot activate
        // more brands than its current package allows.

        // Check Account Status
        const account = await prisma.account.findUnique({
            where: { id: accountId },
            select: { status: true }
        });

        if (status === 'ACTIVE') {
            if (account?.status === 'PENDING_DOWNGRADE') {
                throw new Error('Cannot activate brands while account is pending downgrade. Please resolve the downgrade first.');
            }

            const { plan } = await SubscriptionPolicyService.getEffectivePlan(accountId);
            const activeCount = await prisma.brand.count({
                where: { workspace_id: accountId, status: 'ACTIVE', id: { not: brandId } }
            });

            if (activeCount >= plan.limits.maxBrands) {
                throw new Error(`Cannot activate brand: Plan limit of ${plan.limits.maxBrands} active brands reached.`);
            }
        }

        return prisma.brand.update({
            where: { id: brandId },
            data: { status }
        });
    }

    static async updateBrandBasics(accountId: string, brandId: string, updates: { name?: string; domain?: string }) {
        const brand = await prisma.brand.findFirst({
            where: { id: brandId, workspace_id: accountId }
        });

        if (!brand) throw new Error('Brand not found or access denied');

        const data: Record<string, unknown> = {};
        if (typeof updates.name === 'string' && updates.name.trim()) {
            data.name = updates.name.trim();
        }
        if (typeof updates.domain === 'string' && updates.domain.trim()) {
            data.domain = updates.domain.trim();
        }

        if (Object.keys(data).length === 0) {
            throw new Error('No brand updates provided');
        }

        return prisma.brand.update({
            where: { id: brandId },
            data,
        });
    }
}
