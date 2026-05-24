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
