export interface PlanConfig {
    id: string;
    maxBrands: number;
    canAutomate: boolean;
}

export const PLANS: Record<string, PlanConfig> = {
    FREE: {
        id: 'FREE',
        maxBrands: 1,
        canAutomate: false,
    },
    PRO: {
        id: 'PRO',
        maxBrands: 5,
        canAutomate: true,
    }
};

export type PlanId = keyof typeof PLANS;
