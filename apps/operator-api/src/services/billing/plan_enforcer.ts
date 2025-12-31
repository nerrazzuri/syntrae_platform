import { prisma } from '../../db';
import { PLANS, PlanId } from './plan_definitions';

export class PlanEnforcer {
    static async getPlan(accountId: string) {
        const account = await prisma.account.findUnique({
            where: { id: accountId },
            select: { plan_id: true }
        });
        const planId = (account?.plan_id || 'FREE') as PlanId;
        return PLANS[planId] || PLANS.FREE;
    }

    static async checkBrandLimit(accountId: string) {
        const plan = await this.getPlan(accountId);

        // Count all brands (ACTIVE + PAUSED count towards limit?)
        // Usually yes, otherwise people can pause/unpause to cheat infinite brands.
        // Prompt says: "Free users limited to 1 Brand... User must choose 1 active Brand [on downgrade]... Pause all others".
        // This implies PAUSED brands might exist beyond limit? 
        // "If Brand count > FREE limit: ... Pause all others". 
        // So a FREE user *can* have > 1 brand if they downgraded? 
        // "Free users limited to 1 Brand" usually means "You cannot have 2 ACTIVE brands". 
        // OR does it mean "You cannot CREATE a 2nd brand"?
        // Prompt: "FREE + existing brand -> reject". This implies the hard limit is on COUNT (Existence).
        // But the downgrade flow says "Pause all others", meaning they KEEP the data but can't use it?
        // Let's refine: 
        // 1. Creation Limit: Cannot CREATE if count >= Max.
        // 2. Usage Limit: Cannot have ACTIVE > Max? 
        // PRO -> FREE Downgrade with 5 brands: You keep 5 brands, but 4 must be PAUSED.
        // So Count might exceed Max *after downgrade*.
        // But Creation is definitely blocked.
        // So `checkBrandLimit` blocks CREATION.

        const currentCount = await prisma.brand.count({
            where: { workspace_id: accountId }
        });

        if (currentCount >= plan.maxBrands) {
            throw new Error(`Plan limit reached: Max ${plan.maxBrands} brands allowed on ${plan.id} plan.`);
        }
    }
}
