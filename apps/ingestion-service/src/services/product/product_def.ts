import { buildFeatureFlags, getPlanDefinition, PLAN_CODES, type PlanCode } from '@syntrae/commercial-plans';

export enum PlanId {
    STARTER = 'STARTER',
    GROWTH = 'GROWTH',
    PRO = 'PRO',
    AGENCY = 'AGENCY'
}

export interface SystemCapabilities {
    will_do: string[];
    will_not_do: string[];
}

export const ProductDef = {
    narrative: {
        version: '2.0.0',
        text: 'Syntrae observes social conversations, scores commercial intent, routes high-value opportunities, and keeps human review or safe automation inside package-controlled boundaries.'
    },

    boundaries: {
        will_do: [
            'Observe public comments',
            'Detect buying signals',
            'Generate guided reply drafts',
            'Prioritize leads',
            'Respect package limits deterministically'
        ],
        will_not_do: [
            'Bypass tenant isolation',
            'Allow automation on plans that do not include it',
            'Hide blocked reasons',
            'Mix client data across agency brands',
            'Couple billing logic directly into core enforcement'
        ]
    } as SystemCapabilities,

    getPlan(id: PlanId | string) {
        const plan = getPlanDefinition(id);
        return {
            id: plan.code,
            name: plan.displayName,
            limits: {
                max_events_per_day: plan.limits.dailyProcessedEvents,
                max_events_per_month: plan.limits.monthlyProcessedEvents,
                max_suggestions_per_day: plan.limits.dailySuggestions,
                max_platforms: plan.limits.maxPlatforms,
                max_team_members: plan.limits.maxUsers,
                max_brands: plan.limits.maxBrands,
                automation_eligible: plan.capabilities.automationEnabled,
                export_enabled: plan.capabilities.exportEnabled,
                advanced_scoring_enabled: plan.capabilities.advancedScoringEnabled,
            },
            features: buildFeatureFlags(plan.code),
            notes: `${plan.displayName} package policy`,
        };
    },

    plans: {
        [PlanId.STARTER]: getPlanDefinition(PLAN_CODES.STARTER),
        [PlanId.GROWTH]: getPlanDefinition(PLAN_CODES.GROWTH),
        [PlanId.PRO]: getPlanDefinition(PLAN_CODES.PRO),
        [PlanId.AGENCY]: getPlanDefinition(PLAN_CODES.AGENCY),
    } as Record<PlanCode, ReturnType<typeof getPlanDefinition>>,
};
