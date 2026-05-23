import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/db';
import {
    DEMO_SCENARIOS,
    SIGNAL_BOOST_RECORDS,
    assertSeedAllowed,
    buildSeedMetadata,
    demoCleanupWhere,
} from '../src/services/learningReviewSeed.service';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config();

function applyHostDatabaseFallback() {
    if (fs.existsSync('/.dockerenv')) return;
    if (String(process.env.SEED_DISABLE_LOCAL_DB_FALLBACK || '').toLowerCase() === 'true') return;
    const rawUrl = process.env.DATABASE_URL;
    if (!rawUrl) return;

    try {
        const parsed = new URL(rawUrl);
        if (parsed.hostname !== 'postgresql') return;
        parsed.hostname = 'localhost';
        parsed.port = '15432';
        process.env.DATABASE_URL = parsed.toString();
        console.log('[LearningReviewSeed] Using localhost:15432 for host-side Docker PostgreSQL access.');
    } catch {
        // Leave the original DATABASE_URL in place; Prisma will report any invalid URL.
    }
}

applyHostDatabaseFallback();

const DEFAULT_PLATFORM = 'xiaohongshu';
const DEMO_ACCOUNT_NAME = 'Learning Review Demo Workspace';
const DEMO_BRAND_NAME = 'Learning Review Demo Brand';

function envText(name: string) {
    const value = process.env[name];
    return value && value.trim() ? value.trim() : null;
}

function appUrl() {
    return envText('OPERATOR_UI_URL') || 'http://localhost:5173';
}

async function cleanup() {
    const where = demoCleanupWhere() as any;
    const [candidateResult, planResult, suggestionResult, feedbackResult] = await prisma.$transaction([
        prisma.applyCandidate.deleteMany({ where }),
        prisma.learningApplyPlan.deleteMany({ where }),
        prisma.learningSuggestion.deleteMany({ where }),
        prisma.draftFeedback.deleteMany({ where }),
    ]);

    console.log('[LearningReviewSeed] Cleanup complete');
    console.log(`- ApplyCandidate deleted: ${candidateResult.count}`);
    console.log(`- LearningApplyPlan deleted: ${planResult.count}`);
    console.log(`- LearningSuggestion deleted: ${suggestionResult.count}`);
    console.log(`- DraftFeedback deleted: ${feedbackResult.count}`);
}

async function resolveAccount() {
    const accountId = envText('SEED_ACCOUNT_ID');
    if (accountId) {
        const account = await prisma.account.findUnique({ where: { id: accountId } });
        if (!account) {
            throw new Error(`SEED_ACCOUNT_ID not found: ${accountId}`);
        }
        return account;
    }

    const existing = await prisma.account.findFirst({
        orderBy: { created_at: 'asc' },
    });
    if (existing) return existing;

    return prisma.account.create({
        data: {
            name: DEMO_ACCOUNT_NAME,
            status: 'ACTIVE',
            plan_id: 'PRO',
            onboarding_state: 'ONBOARDED',
        },
    });
}

async function resolveBrand(accountId: string) {
    const brandId = envText('SEED_BRAND_ID');
    if (brandId) {
        const brand = await prisma.brand.findUnique({ where: { id: brandId } });
        if (!brand) {
            throw new Error(`SEED_BRAND_ID not found: ${brandId}`);
        }
        if (brand.workspace_id !== accountId) {
            throw new Error(`SEED_BRAND_ID ${brandId} does not belong to account ${accountId}`);
        }
        return brand;
    }

    const existing = await prisma.brand.findFirst({
        where: { workspace_id: accountId },
        orderBy: { created_at: 'asc' },
    });
    if (existing) return existing;

    return prisma.brand.create({
        data: {
            workspace_id: accountId,
            name: DEMO_BRAND_NAME,
            domain: 'learning-review-demo.local',
            domain_context: buildSeedMetadata({
                description: 'Demo brand for learning review manual QA seed data.',
            }),
            status: 'ACTIVE',
        },
    });
}

function feedbackTypeForReasons(reasons: readonly string[]) {
    if (reasons.includes('WRONG_INTENT')) return 'WRONG_STRATEGY';
    if (reasons.includes('TOO_SALESY')) return 'TOO_SALESY';
    if (reasons.includes('PRODUCT_INFO_WRONG')) return 'REJECTED';
    return 'TOO_AI';
}

function demoOriginalDraftText(scenario: typeof DEMO_SCENARIOS[number]) {
    if (scenario.selectedReasons.includes('TOO_SALESY')) {
        return 'Thank you for your interest! Please visit our store to explore more options and place your order today.';
    }
    if (scenario.selectedReasons.includes('WRONG_INTENT')) {
        return 'You can buy this from our product page. The link is available in the store profile.';
    }
    if (scenario.selectedReasons.includes('PRODUCT_INFO_WRONG')) {
        return 'This product is compatible with every device and is guaranteed to work for all users.';
    }
    return 'Dear customer, thank you for your attention. We are committed to helping you find the perfect product.';
}

function demoHumanEditedText(scenario: typeof DEMO_SCENARIOS[number]) {
    if (scenario.selectedReasons.includes('TOO_SALESY')) {
        return 'Start with the user context first; do not push an order. If they only want to try it, suggest a lower-risk option.';
    }
    if (scenario.selectedReasons.includes('WRONG_INTENT')) {
        return 'The user asked whether it fits, not where to buy. Answer the fit question before mentioning any purchase path.';
    }
    if (scenario.selectedReasons.includes('PRODUCT_INFO_WRONG')) {
        return 'Compatibility depends on the exact model and port. Ask for the device model instead of assuming universal support.';
    }
    return 'Avoid customer-service phrasing. Answer the real question directly, then add one concrete suggestion.';
}

function demoFinalSentText(scenario: typeof DEMO_SCENARIOS[number]) {
    if (scenario.suggestionStatus === 'REJECTED') return null;
    return demoHumanEditedText(scenario);
}

function suggestionPayload(scenario: typeof DEMO_SCENARIOS[number], index: number) {
    return {
        title: `Demo ${index + 1}: ${scenario.key.replace(/_/g, ' ')}`,
        message: `Seeded learning review scenario for ${scenario.key}.`,
        evidence: {
            scenario: scenario.key,
            selected_reasons: scenario.selectedReasons,
            count: index + 2,
        },
        proposed_action: {
            actions: [
                'Review the linked feedback example.',
                'Use this record only for manual QA.',
            ],
        },
        source_insight: {
            seed_scenario: scenario.key,
            demo: true,
        },
    };
}

async function createScenarioRecords(accountId: string, brandId: string, platform: string) {
    const created: Array<Record<string, any>> = [];

    for (const [index, scenario] of DEMO_SCENARIOS.entries()) {
        const metadata = buildSeedMetadata({
            scenario: scenario.key,
            ordinal: index + 1,
        });
        const outreachDraftId = `learning-review-demo-draft-${scenario.key}`;
        const feedback = await prisma.draftFeedback.create({
            data: {
                account_id: accountId,
                brand_id: brandId,
                outreach_draft_id: outreachDraftId,
                platform,
                feedback_type: feedbackTypeForReasons(scenario.selectedReasons) as any,
                selected_reasons: scenario.selectedReasons,
                original_draft_text: demoOriginalDraftText(scenario),
                human_edited_text: demoHumanEditedText(scenario),
                final_sent_text: demoFinalSentText(scenario),
                reply_strategy: scenario.suggestionType === 'CTA_GATING_REVIEW'
                    ? 'suitability_advice'
                    : 'product_question',
                reply_mode: 'answer_first',
                product_grounding_mode: 'answer_from_product',
                buyer_stage: 'EVALUATING',
                intent: 'DEMO_SEED',
                qc_status: {
                    passed: !scenario.selectedReasons.includes('TOO_AI'),
                    flags: scenario.selectedReasons,
                },
                generation_meta: {
                    prompt_version: 'learning_review_demo_seed',
                    strategy_meta: {
                        reply_mode: 'answer_first',
                        product_grounding_mode: 'answer_from_product',
                    },
                },
                metadata,
            },
        });

        const payload = suggestionPayload(scenario, index);
        const suggestion = await prisma.learningSuggestion.create({
            data: {
                account_id: accountId,
                brand_id: brandId,
                platform,
                suggestion_type: scenario.suggestionType as any,
                status: scenario.suggestionStatus as any,
                severity: index === 0 ? 'HIGH' : index === 3 ? 'MEDIUM' : 'LOW',
                title: payload.title,
                message: payload.message,
                evidence: payload.evidence,
                proposed_action: payload.proposed_action,
                source_insight: payload.source_insight,
                source_feedback_ids: [feedback.id],
                metadata,
            },
        });

        let plan: any = null;
        if (scenario.planStatus) {
            const targetArea = scenario.suggestionType === 'INTENT_MAPPING_REVIEW'
                ? 'intent_mapping'
                : scenario.suggestionType === 'PRODUCT_GROUNDING_REVIEW'
                    ? 'product_grounding'
                    : 'ai_core_prompt_style';
            plan = await prisma.learningApplyPlan.create({
                data: {
                    account_id: accountId,
                    brand_id: brandId,
                    platform,
                    learning_suggestion_id: suggestion.id,
                    status: scenario.planStatus as any,
                    target_area: targetArea,
                    proposed_change_type: scenario.planStatus === 'REVIEWED'
                        ? 'catalog_grounding_review'
                        : 'fallback_bucket_review',
                    risk_level: index === 3 ? 'high' : 'medium',
                    summary: `Demo apply plan for ${scenario.key}`,
                    rationale: 'Seeded apply plan for manual QA only. It does not change runtime behavior.',
                    proposed_patch: null,
                    proposed_config_change: {
                        candidate_changes: ['Manual QA seed only'],
                    },
                    suggested_tests: [
                        'Confirm the UI renders this apply plan.',
                        'Confirm plan actions do not mutate AI runtime behavior.',
                    ],
                    blocked_auto_apply_reason: 'Demo seed plans are review artifacts only.',
                    requires_human_approval: true,
                    metadata,
                },
            });
        }

        let candidate: any = null;
        if (plan && scenario.candidateStatus) {
            candidate = await prisma.applyCandidate.create({
                data: {
                    account_id: accountId,
                    brand_id: brandId,
                    platform,
                    learning_suggestion_id: suggestion.id,
                    learning_apply_plan_id: plan.id,
                    candidate_type: 'PRODUCT_GROUNDING_REVIEW',
                    status: scenario.candidateStatus as any,
                    title: `Demo pending candidate for ${scenario.key}`,
                    description: 'Seeded inactive candidate for manual QA only.',
                    candidate_payload: {
                        target: 'catalog_match_or_knowledge_retrieval',
                        review_required: true,
                        requires_code_change: false,
                    },
                    source_feedback_ids: [feedback.id],
                    risk_level: 'high',
                    metadata,
                },
            });
        }

        created.push({
            scenario: scenario.key,
            feedback_id: feedback.id,
            suggestion_id: suggestion.id,
            apply_plan_id: plan?.id || null,
            candidate_id: candidate?.id || null,
        });
    }

    return created;
}

async function createSignalBoostRecords(accountId: string, brandId: string, platform: string) {
    const created: string[] = [];
    for (const record of SIGNAL_BOOST_RECORDS) {
        const hasToAI = record.selectedReasons.includes('TOO_AI');
        const hasToSalesy = record.selectedReasons.includes('TOO_SALESY');
        const hasWrongIntent = record.selectedReasons.includes('WRONG_INTENT');
        const hasProductWrong = record.selectedReasons.includes('PRODUCT_INFO_WRONG');

        let feedbackType: string;
        if (hasWrongIntent) feedbackType = 'WRONG_STRATEGY';
        else if (hasToSalesy) feedbackType = 'TOO_SALESY';
        else if (hasProductWrong) feedbackType = 'REJECTED';
        else feedbackType = 'TOO_AI';

        const metadata = buildSeedMetadata({ signal_boost: true, signal_key: record.key });
        const row = await prisma.draftFeedback.create({
            data: {
                account_id: accountId,
                brand_id: brandId,
                outreach_draft_id: `learning-review-demo-signal-${record.key}`,
                platform,
                feedback_type: feedbackType as any,
                selected_reasons: [...record.selectedReasons],
                original_draft_text: record.originalDraftText,
                human_edited_text: record.humanEditedText,
                final_sent_text: record.humanEditedText,
                reply_strategy: 'product_question',
                reply_mode: 'answer_first',
                product_grounding_mode: 'answer_from_product',
                buyer_stage: 'EVALUATING',
                intent: 'DEMO_SEED',
                qc_status: {
                    passed: !hasToAI,
                    flags: [...record.selectedReasons],
                },
                generation_meta: {
                    prompt_version: 'learning_review_demo_seed',
                    strategy_meta: { reply_mode: 'answer_first', product_grounding_mode: 'answer_from_product' },
                },
                metadata,
            },
        });
        created.push(row.id);
    }
    return created;
}

async function seed() {
    assertSeedAllowed({
        nodeEnv: process.env.NODE_ENV,
        confirm: process.env.CONFIRM_SEED_LEARNING_REVIEW_DEMO,
    });

    const account = await resolveAccount();
    const brand = await resolveBrand(account.id);
    const platform = envText('SEED_PLATFORM') || DEFAULT_PLATFORM;
    const created = await createScenarioRecords(account.id, brand.id, platform);
    const signalIds = await createSignalBoostRecords(account.id, brand.id, platform);

    console.log('[LearningReviewSeed] Demo records created');
    console.log(`Account: ${account.id} (${account.name})`);
    console.log(`Brand: ${brand.id} (${brand.name})`);
    console.log(`Platform: ${platform}`);
    for (const row of created) {
        console.log(JSON.stringify(row));
    }
    console.log(`[LearningReviewSeed] Signal boost feedback created: ${signalIds.length} records`);
    console.log('  After seeding, call POST /internal/learning-suggestions/generate to produce all 5 OPEN suggestion types.');
    console.log(`Open UI: ${appUrl()}/admin/learning-review`);
    console.log('Cleanup: SEED_CLEANUP=true pnpm --filter operator-api seed:learning-review-demo');
}

async function main() {
    assertSeedAllowed({
        nodeEnv: process.env.NODE_ENV,
        confirm: process.env.CONFIRM_SEED_LEARNING_REVIEW_DEMO,
    });

    if (String(process.env.SEED_CLEANUP || '').toLowerCase() === 'true') {
        await cleanup();
        return;
    }

    await seed();
}

main()
    .catch((error) => {
        console.error('[LearningReviewSeed] Failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
