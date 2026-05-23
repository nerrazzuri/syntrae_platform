export const LEARNING_REVIEW_DEMO_SEED_NAME = 'learning_review_demo';

export const DEMO_FEEDBACK_REASONS = [
    'TOO_AI',
    'TOO_SALESY',
    'WRONG_INTENT',
    'PRODUCT_INFO_WRONG',
    'TOO_GENERIC',
    'MISSED_USER_QUESTION',
] as const;

// Extra feedback-only records (no matching suggestion) that boost signal counts so all 5
// major suggestion types trigger when the generate endpoint is called after seeding.
// With the 5 DEMO_SCENARIOS records: TOO_AI=2, TOO_SALESY=2, qc_mismatch=1.
// These 4 records push every signal to count>=3 (the highCount threshold), total=9.
export const SIGNAL_BOOST_RECORDS = [
    // 3 x qc_passed=true + REJECTED → boosts qc_mismatch to 4; TOO_GENERIC=3; MISSED_USER_QUESTION=3
    {
        key: 'signal_generic_q1',
        selectedReasons: ['TOO_GENERIC', 'MISSED_USER_QUESTION', 'PRODUCT_INFO_WRONG'],
        originalDraftText: 'This product is really great and many customers love it. It comes in many styles.',
        humanEditedText: 'The user asked about the specific color. Answer that directly before any styling advice.',
    },
    {
        key: 'signal_generic_q2',
        selectedReasons: ['TOO_GENERIC', 'MISSED_USER_QUESTION', 'PRODUCT_INFO_WRONG'],
        originalDraftText: 'We recommend considering your lifestyle and preferences when choosing the right product for you.',
        humanEditedText: 'The user asked about the price. Answer the price first.',
    },
    {
        key: 'signal_generic_q3',
        selectedReasons: ['TOO_GENERIC', 'MISSED_USER_QUESTION', 'PRODUCT_INFO_WRONG'],
        originalDraftText: 'Thank you for your interest! Our products have features that are suitable for all users.',
        humanEditedText: 'The user asked about compatibility. Answer compatibility directly.',
    },
    // 1 x qc_passed=false → boosts TOO_AI to 3; TOO_SALESY to 3
    {
        key: 'signal_ai_salesy',
        selectedReasons: ['TOO_AI', 'TOO_SALESY'],
        originalDraftText: 'Dear valued customer, we are pleased to offer you our premium products. Shop now and save!',
        humanEditedText: null,
    },
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
