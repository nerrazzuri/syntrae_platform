import { SubscriptionPolicyService } from './subscription_policy.service';

export class PlanEnforcer {
    static async getPlan(accountId: string) {
        const { plan } = await SubscriptionPolicyService.getEffectivePlan(accountId);
        return {
            id: plan.code,
            maxBrands: plan.limits.maxBrands,
            canAutomate: plan.capabilities.automationEnabled,
            ...plan,
        };
    }

    static async checkBrandLimit(accountId: string) {
        await SubscriptionPolicyService.assertCanCreateAdditionalBrand(accountId);
    }
}
