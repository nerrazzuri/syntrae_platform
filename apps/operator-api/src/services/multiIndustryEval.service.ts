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

// ---------------------------------------------------------------------------
// Negation-aware mention detection
// ---------------------------------------------------------------------------

// English negation patterns (word-bounded for short terms to avoid false matches
// like "notation" matching /not/ or "android" matching /no/).
const NEGATION_PATTERNS_EN: RegExp[] = [
    /\bno\b/,
    /\bnot\b/,
    /doesn't/,
    /does\s+not/,
    /don't/,
    /do\s+not/,
    /isn't/,
    /is\s+not/,
    /aren't/,
    /are\s+not/,
    /\bwithout\b/,
    /\bunavailable\b/,
    /not\s+supported/,
    /not\s+directly/,
    /no\s+native/,
    /no\s+dedicated/,
    /cannot\s+confirm/,
    /not\s+confirmed/,
    /can't\s+confirm/,
];

// Multi-character Chinese negation terms — checked in full window (60 chars).
const ZH_NEGATIONS_MULTI = [
    '不含', '没有', '没看到', '暂不', '不是', '不支持', '不能确认', '资料里没有',
];

// Single-character Chinese negation terms — checked only in a tight prefix window
// (10 chars before keyword, no suffix) to avoid matching unrelated negations like
// "不用担心" (no need to worry) appearing after a positive claim.
const ZH_NEGATIONS_SINGLE = ['不', '未', '无'];

/**
 * Returns true when `keyword` appears in `text` and a negation term is found
 * in a context window around that occurrence.
 *
 * English negations use a ±60-char window with word-boundary regex.
 * Chinese multi-char negations use a ±60-char window.
 * Chinese single-char negations ('不','未','无') use only a 10-char prefix window
 * so that reassurance phrases like "无需担心" after a positive claim do not
 * accidentally suppress a true hallucination flag.
 */
export function isNegatedMention(text: string, keyword: string, windowChars = 60): boolean {
    const lower = text.toLowerCase();
    const kwLower = keyword.toLowerCase();

    let idx = 0;
    while (idx < lower.length) {
        const pos = lower.indexOf(kwLower, idx);
        if (pos === -1) break;

        const kwEnd = pos + kwLower.length;

        // Full window for English and multi-char Chinese negations
        const fullStart = Math.max(0, pos - windowChars);
        const fullEnd = Math.min(lower.length, kwEnd + windowChars);
        const fullWindowLower = lower.slice(fullStart, fullEnd);
        const fullWindowOrig = text.slice(fullStart, fullEnd);

        for (const pattern of NEGATION_PATTERNS_EN) {
            if (pattern.test(fullWindowLower)) return true;
        }
        for (const neg of ZH_NEGATIONS_MULTI) {
            if (fullWindowOrig.includes(neg)) return true;
        }

        // Tight prefix-only window for single-char Chinese negations.
        // Ends at keyword boundary so trailing reassurances ("无需担心") don't fire.
        const tightStart = Math.max(0, pos - 10);
        const tightWindowOrig = text.slice(tightStart, kwEnd);
        for (const neg of ZH_NEGATIONS_SINGLE) {
            if (tightWindowOrig.includes(neg)) return true;
        }

        idx = pos + 1;
    }

    return false;
}

// GDPR positive-claim patterns to catch beyond the original "gdpr compliant" phrase.
const GDPR_CLAIM_PATTERNS = [
    'gdpr compliant',
    'gdpr-compliant',
    'gdpr compliance',
    'gdpr-ready',
    'gdpr aligned',
    'comply with gdpr',
];

// Country/region names that indicate a data-residency claim when the location is unknown.
const DATA_RESIDENCY_COUNTRIES = [
    'united states', 'united kingdom', 'singapore', 'germany',
    'japan', 'australia', 'canada', 'china', 'india', 'ireland',
];

// Pattern for short region codes in storage context ("stored in the US" etc.).
const DATA_RESIDENCY_REGION_PATTERN =
    /(?:stored|hosted|located|based)\s+in\s+(?:the\s+)?(?:us|eu|europe|usa|uk)\b/i;

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

    // Niacinamide / 烟酰胺 not in ingredients — skip if claim is negated
    if (!ingredients.some((i) => i.toLowerCase().includes('niacinamide'))) {
        const hasEn = reply.includes('niacinamide');
        const hasZh = replyText.includes('烟酰胺');
        if (
            (hasEn && !isNegatedMention(replyText, 'niacinamide')) ||
            (hasZh && !isNegatedMention(replyText, '烟酰胺'))
        ) {
            facts.push('niacinamide / 烟酰胺 claimed but not in ingredients_summary');
        }
    }

    // Alcohol-free claim when alcohol not in free_from — skip if negated
    if (!freeFrom.some((f) => f.toLowerCase().includes('alcohol'))) {
        if (reply.includes('alcohol-free') && !isNegatedMention(replyText, 'alcohol-free')) {
            facts.push('alcohol-free claimed but not in free_from');
        }
        if (replyText.includes('不含酒精') && !isNegatedMention(replyText, '不含酒精')) {
            facts.push('alcohol-free claimed but not in free_from');
        }
    }

    // Pregnancy safe claim when in not_claimed — skip if negated
    if (notClaimed.some((c) => c.toLowerCase().includes('pregnancy'))) {
        const pregnancyTerms: Array<[string, boolean]> = [
            ['pregnancy safe', reply.includes('pregnancy safe')],
            ['safe for pregnant', reply.includes('safe for pregnant')],
            ['孕妇可以用', replyText.includes('孕妇可以用')],
            ['孕期可以用', replyText.includes('孕期可以用')],
        ];
        for (const [term, present] of pregnancyTerms) {
            if (present && !isNegatedMention(replyText, term)) {
                facts.push('pregnancy safe claimed but listed in not_claimed');
                break;
            }
        }
    }

    // Wear time duration when listed as unknown (makeup) — skip if negated
    if (unknowns.some((u) => u.toLowerCase().includes('wear time'))) {
        const wearMatch =
            /\b(\d+[\s-]+\d+\s*hours?|\d+\s*hours?\s*(?:of\s+)?wear)\b/.exec(reply);
        const hasZhWear =
            replyText.includes('小时持妆') || replyText.includes('小时不脱色');

        if (wearMatch && !isNegatedMention(replyText, wearMatch[0])) {
            facts.push('wear time duration stated but listed as unknown');
        } else if (hasZhWear) {
            const zhTerm = replyText.includes('小时持妆') ? '小时持妆' : '小时不脱色';
            if (!isNegatedMention(replyText, zhTerm)) {
                facts.push('wear time duration stated but listed as unknown');
            }
        }
    }

    // Waterproof claim when in not_claimed — skip if negated
    if (notClaimed.some((c) => c.toLowerCase().includes('waterproof'))) {
        if (reply.includes('waterproof') && !isNegatedMention(replyText, 'waterproof')) {
            facts.push('waterproof claimed but listed in not_claimed');
        }
    }

    // SaaS: features in not_supported — skip if negated
    for (const feature of notSupported) {
        if (
            reply.includes(feature.toLowerCase()) &&
            !isNegatedMention(replyText, feature)
        ) {
            facts.push(`"${feature}" claimed but listed in not_supported`);
        }
    }

    // SaaS: Slack not in integrations — skip if negated
    if (!integrations.some((i) => i.toLowerCase().includes('slack'))) {
        if (reply.includes('slack') && !isNegatedMention(replyText, 'slack')) {
            facts.push('Slack integration claimed but not in integrations');
        }
    }

    // SaaS: Salesforce unknown — skip if negated
    if (unknowns.some((u) => u.toLowerCase().includes('salesforce'))) {
        if (reply.includes('salesforce') && !isNegatedMention(replyText, 'salesforce')) {
            facts.push('Salesforce integration claimed but listed as unknown');
        }
    }

    // SaaS: security claims — skip if negated
    if (security) {
        if (
            security.encryption_at_rest === 'unknown' &&
            reply.includes('encrypted at rest') &&
            !isNegatedMention(replyText, 'encrypted at rest')
        ) {
            facts.push('encrypted at rest claimed but listed as unknown');
        }

        // Broadened GDPR detection: catches "gdpr compliance", "gdpr-ready", etc.
        if (security.gdpr === 'not confirmed') {
            for (const pattern of GDPR_CLAIM_PATTERNS) {
                if (reply.includes(pattern) && !isNegatedMention(replyText, pattern)) {
                    facts.push('GDPR compliant claimed but not confirmed');
                    break;
                }
            }
        }
    }

    // Data residency claim when location is unknown
    if (unknowns.some((u) => /data.?residency|data.*country/i.test(u))) {
        let claimed: string | null = null;

        for (const country of DATA_RESIDENCY_COUNTRIES) {
            if (reply.includes(country) && !isNegatedMention(replyText, country)) {
                claimed = country;
                break;
            }
        }
        if (!claimed) {
            const m = DATA_RESIDENCY_REGION_PATTERN.exec(reply);
            if (m && !isNegatedMention(replyText, m[0])) {
                claimed = m[0];
            }
        }
        if (claimed) {
            facts.push('data residency location claimed but listed as unknown');
        }
    }

    // SaaS: free trial contradiction — the LLM denies a trial the product actually offers.
    // No negation check here: the denial IS the hallucination.
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
