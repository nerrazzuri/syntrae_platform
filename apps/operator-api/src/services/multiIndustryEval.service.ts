import fs from 'node:fs';
import path from 'node:path';

export const ALLOWED_SCENARIOS = [
    'product_question',
    'suitability_advice',
    'purchase_request',
    'comparison_request',
    'objection_or_concern',
    'general_interest',
] as const;

export type EvalScenario = (typeof ALLOWED_SCENARIOS)[number];

export interface EvalItem {
    id: string;
    industry: string;
    platform: string;
    comment_text: string;
    scenario: EvalScenario;
    expected_reply_strategy: string;
    expected_should_redirect: boolean;
    expected_notes: string[];
    product_context?: Record<string, unknown>;
    knowledge_context?: Array<Record<string, unknown>>;
}

export interface UnsupportedFactsResult {
    unsupported_fact_count: number;
    unsupported_facts: string[];
}

export interface EvalPackSummary {
    total: number;
    industry: string;
    platform: string;
    by_scenario: Record<string, number>;
    by_expected_strategy: Record<string, number>;
    purchase_intent_count: number;
    safety_sensitive_count: number;
}

const PACK_FILE_MAP: Record<string, string> = {
    skincare_xhs: 'skincare_xhs_eval.json',
    makeup_xhs: 'makeup_xhs_eval.json',
    saas_b2b: 'saas_b2b_eval.json',
};

const FIXTURES_DIR = path.resolve(__dirname, '../../fixtures/evals');

const SAFETY_KEYWORDS = [
    '孕妇', '宝宝', '过敏', '敏感', '闷痘', 'safe', 'allergy', 'encrypted', 'gdpr', 'security',
    '安全', '副作用', '刺激', 'compliance', 'data stored',
];

export function loadEvalPack(packName: string): EvalItem[] {
    const filename = PACK_FILE_MAP[packName];
    if (!filename) {
        throw new Error(
            `Unknown eval pack: "${packName}". Supported packs: ${Object.keys(PACK_FILE_MAP).join(', ')}`,
        );
    }
    const filePath = path.join(FIXTURES_DIR, filename);
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as EvalItem[];
}

export function validateEvalPack(pack: EvalItem[]): void {
    if (!Array.isArray(pack) || pack.length !== 30) {
        throw new Error(`Pack must contain exactly 30 items, got ${Array.isArray(pack) ? pack.length : 'non-array'}`);
    }

    const ids = new Set<string>();
    const errors: string[] = [];

    for (const item of pack) {
        const prefix = `[${item.id ?? '?'}]`;

        if (!item.id || typeof item.id !== 'string') errors.push(`${prefix} missing or invalid id`);
        if (!item.industry || typeof item.industry !== 'string') errors.push(`${prefix} missing industry`);
        if (!item.platform || typeof item.platform !== 'string') errors.push(`${prefix} missing platform`);
        if (!item.comment_text || typeof item.comment_text !== 'string') errors.push(`${prefix} missing comment_text`);
        if (!item.expected_reply_strategy || typeof item.expected_reply_strategy !== 'string')
            errors.push(`${prefix} missing expected_reply_strategy`);
        if (typeof item.expected_should_redirect !== 'boolean')
            errors.push(`${prefix} expected_should_redirect must be boolean`);
        if (!ALLOWED_SCENARIOS.includes(item.scenario as EvalScenario))
            errors.push(`${prefix} invalid scenario "${item.scenario}"`);
        if (
            item.product_context !== undefined &&
            (typeof item.product_context !== 'object' ||
                Array.isArray(item.product_context) ||
                item.product_context === null)
        )
            errors.push(`${prefix} product_context must be an object if present`);
        if (item.knowledge_context !== undefined && !Array.isArray(item.knowledge_context))
            errors.push(`${prefix} knowledge_context must be an array if present`);

        if (item.id) {
            if (ids.has(item.id)) errors.push(`Duplicate id: "${item.id}"`);
            ids.add(item.id);
        }
    }

    if (errors.length > 0) {
        throw new Error(`Eval pack validation failed:\n${errors.join('\n')}`);
    }
}

export function summarizeEvalPack(pack: EvalItem[]): EvalPackSummary {
    const by_scenario: Record<string, number> = {};
    const by_expected_strategy: Record<string, number> = {};
    let purchase_intent_count = 0;
    let safety_sensitive_count = 0;

    for (const item of pack) {
        by_scenario[item.scenario] = (by_scenario[item.scenario] ?? 0) + 1;
        by_expected_strategy[item.expected_reply_strategy] =
            (by_expected_strategy[item.expected_reply_strategy] ?? 0) + 1;

        if (item.expected_reply_strategy === 'purchase_request' || item.expected_should_redirect) {
            purchase_intent_count++;
        }

        const lc = item.comment_text.toLowerCase();
        if (SAFETY_KEYWORDS.some((kw) => lc.includes(kw.toLowerCase()))) {
            safety_sensitive_count++;
        }
    }

    const industry = pack[0]?.industry ?? '';
    const platform = pack[0]?.platform ?? '';

    return {
        total: pack.length,
        industry,
        platform,
        by_scenario,
        by_expected_strategy,
        purchase_intent_count,
        safety_sensitive_count,
    };
}

export function detectUnsupportedFacts(
    replyText: string,
    productContext: Record<string, unknown>,
): UnsupportedFactsResult {
    const facts: string[] = [];
    const reply = replyText.toLowerCase();

    const unknowns = (productContext.unknowns as string[] | undefined) ?? [];
    const notClaimed = (productContext.not_claimed as string[] | undefined) ?? [];
    const notSupported = (productContext.not_supported as string[] | undefined) ?? [];
    const ingredients = (productContext.ingredients_summary as string[] | undefined) ?? [];
    const freeFrom = (productContext.free_from as string[] | undefined) ?? [];
    const integrations = (productContext.integrations as string[] | undefined) ?? [];
    const security = productContext.security as Record<string, unknown> | undefined;
    const pricing = productContext.pricing as Record<string, unknown> | undefined;

    // SPF claim when unknown
    if (unknowns.some((u) => u.toLowerCase().includes('spf'))) {
        if (/spf\s*\d+/.test(reply)) {
            facts.push('SPF value stated but listed as unknown');
        }
    }

    // Ingredient not in ingredients_summary
    const ingredientChecks: Array<[string, string]> = [
        ['niacinamide', 'niacinamide'],
        ['烟酰胺', 'niacinamide'],
    ];
    for (const [term, canonical] of ingredientChecks) {
        if (
            !ingredients.some((i) => i.toLowerCase().includes(canonical)) &&
            replyText.toLowerCase().includes(term.toLowerCase())
        ) {
            facts.push(`${term} claimed but not in ingredients_summary`);
            break;
        }
    }

    // Alcohol-free claim when alcohol not in free_from
    if (!freeFrom.some((f) => f.toLowerCase().includes('alcohol'))) {
        if (reply.includes('alcohol-free') || reply.includes('不含酒精')) {
            facts.push('alcohol-free claimed but not in free_from');
        }
    }

    // Pregnancy safe claim when in not_claimed
    if (notClaimed.some((c) => c.toLowerCase().includes('pregnancy'))) {
        if (
            reply.includes('pregnancy safe') ||
            reply.includes('safe for pregnant') ||
            replyText.includes('孕妇可以用') ||
            replyText.includes('孕期可以用')
        ) {
            facts.push('pregnancy safe claimed but listed in not_claimed');
        }
    }

    // Wear time duration when listed as unknown (makeup)
    if (unknowns.some((u) => u.toLowerCase().includes('wear time'))) {
        if (
            /\b\d+[\s-]+\d+\s*hours?\b/.test(reply) ||
            /\b\d+\s*hours?\s*(of\s+)?wear\b/.test(reply) ||
            replyText.includes('小时持妆') ||
            replyText.includes('小时不脱色')
        ) {
            facts.push('wear time duration stated but listed as unknown');
        }
    }

    // Waterproof claim when in not_claimed
    if (notClaimed.some((c) => c.toLowerCase().includes('waterproof'))) {
        if (reply.includes('waterproof')) {
            facts.push('waterproof claimed but listed in not_claimed');
        }
    }

    // SaaS: features in not_supported claimed in reply
    for (const feature of notSupported) {
        if (reply.includes(feature.toLowerCase())) {
            facts.push(`"${feature}" claimed but listed in not_supported`);
        }
    }

    // SaaS: Slack not in integrations
    if (!integrations.some((i) => i.toLowerCase().includes('slack'))) {
        if (reply.includes('slack')) {
            facts.push('Slack integration claimed but not in integrations');
        }
    }

    // SaaS: Salesforce unknown
    if (unknowns.some((u) => u.toLowerCase().includes('salesforce'))) {
        if (reply.includes('salesforce')) {
            facts.push('Salesforce integration claimed but listed as unknown');
        }
    }

    // SaaS: security claims
    if (security) {
        if (security.encryption_at_rest === 'unknown' && reply.includes('encrypted at rest')) {
            facts.push('encrypted at rest claimed but listed as unknown');
        }
        if (
            security.gdpr === 'not confirmed' &&
            (reply.includes('gdpr compliant') || reply.includes('gdpr-compliant'))
        ) {
            facts.push('GDPR compliant claimed but not confirmed');
        }
    }

    // SaaS: free trial contradiction
    if (pricing) {
        const hasTrial = pricing.free_trial;
        if (hasTrial && hasTrial !== 'none' && typeof hasTrial === 'string') {
            if (reply.includes('no free trial') || reply.includes("don't offer a free trial")) {
                facts.push(`free trial contradiction: product has ${hasTrial} free trial but reply denies it`);
            }
        }
    }

    return {
        unsupported_fact_count: facts.length,
        unsupported_facts: facts,
    };
}
