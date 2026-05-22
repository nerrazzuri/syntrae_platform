export const LEARNING_REVIEW_DEMO_SEED_NAME = 'learning_review_demo';

export const DEMO_FEEDBACK_REASONS = [
    'TOO_AI',
    'TOO_SALESY',
    'WRONG_INTENT',
    'PRODUCT_INFO_WRONG',
] as const;

export const DEMO_SCENARIOS = [
    {
        key: 'open_no_plan',
        suggestionStatus: 'OPEN',
        planStatus: null,
        candidateStatus: null,
        suggestionType: 'PROMPT_STYLE_REVIEW',
        selectedReasons: ['TOO_AI'],
    },
    {
        key: 'accepted_no_plan',
        suggestionStatus: 'ACCEPTED',
        planStatus: null,
        candidateStatus: null,
        suggestionType: 'CTA_GATING_REVIEW',
        selectedReasons: ['TOO_SALESY'],
    },
    {
        key: 'accepted_draft_plan',
        suggestionStatus: 'ACCEPTED',
        planStatus: 'DRAFT',
        candidateStatus: null,
        suggestionType: 'INTENT_MAPPING_REVIEW',
        selectedReasons: ['WRONG_INTENT'],
    },
    {
        key: 'accepted_reviewed_plan_pending_candidate',
        suggestionStatus: 'ACCEPTED',
        planStatus: 'REVIEWED',
        candidateStatus: 'PENDING',
        suggestionType: 'PRODUCT_GROUNDING_REVIEW',
        selectedReasons: ['PRODUCT_INFO_WRONG'],
    },
    {
        key: 'rejected_no_plan',
        suggestionStatus: 'REJECTED',
        planStatus: null,
        candidateStatus: null,
        suggestionType: 'DRAFT_QC_RULE_REVIEW',
        selectedReasons: ['TOO_AI', 'TOO_SALESY'],
    },
] as const;

export function buildSeedMetadata(extra: Record<string, any> = {}) {
    return {
        demo_seed: true,
        seed_name: LEARNING_REVIEW_DEMO_SEED_NAME,
        ...extra,
    };
}

export function demoCleanupWhere() {
    return {
        AND: [
            { metadata: { path: ['demo_seed'], equals: true } },
            { metadata: { path: ['seed_name'], equals: LEARNING_REVIEW_DEMO_SEED_NAME } },
        ],
    };
}

export function assertSeedAllowed(input: {
    nodeEnv?: string | null;
    confirm?: string | boolean | null;
}) {
    const env = String(input.nodeEnv || '').trim().toLowerCase();
    const confirmed = input.confirm === true || String(input.confirm || '').toLowerCase() === 'true';
    if (env === 'production' && !confirmed) {
        throw new Error(
            'Refusing to seed learning review demo data in production without CONFIRM_SEED_LEARNING_REVIEW_DEMO=true',
        );
    }
}
