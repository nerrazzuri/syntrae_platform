import test from 'node:test';
import assert from 'node:assert/strict';

import {
    loadEvalPack,
    validateEvalPack,
    summarizeEvalPack,
    detectUnsupportedFacts,
    isNegatedMention,
    ALLOWED_SCENARIOS,
    type EvalItem,
} from '../src/services/multiIndustryEval.service';

// --- helpers ---

function loadAndValidate(packName: string): EvalItem[] {
    const pack = loadEvalPack(packName);
    validateEvalPack(pack);
    return pack;
}

// --- load tests ---

test('skincare pack loads without error', () => {
    const pack = loadEvalPack('skincare_xhs');
    assert.ok(Array.isArray(pack));
});

test('makeup pack loads without error', () => {
    const pack = loadEvalPack('makeup_xhs');
    assert.ok(Array.isArray(pack));
});

test('SaaS pack loads without error', () => {
    const pack = loadEvalPack('saas_b2b');
    assert.ok(Array.isArray(pack));
});

// --- count tests ---

test('skincare pack has exactly 30 items', () => {
    assert.equal(loadEvalPack('skincare_xhs').length, 30);
});

test('makeup pack has exactly 30 items', () => {
    assert.equal(loadEvalPack('makeup_xhs').length, 30);
});

test('SaaS pack has exactly 30 items', () => {
    assert.equal(loadEvalPack('saas_b2b').length, 30);
});

// --- id uniqueness ---

test('all fixture ids are unique within each pack', () => {
    for (const packName of ['skincare_xhs', 'makeup_xhs', 'saas_b2b']) {
        const pack = loadEvalPack(packName);
        const ids = pack.map((item) => item.id);
        const unique = new Set(ids);
        assert.equal(unique.size, ids.length, `Duplicate ids in pack: ${packName}`);
    }
});

// --- required fields ---

test('every item has required fields', () => {
    const requiredStringFields = [
        'id',
        'industry',
        'platform',
        'comment_text',
        'scenario',
        'expected_reply_strategy',
    ] as const;

    for (const packName of ['skincare_xhs', 'makeup_xhs', 'saas_b2b']) {
        const pack = loadEvalPack(packName);
        for (const item of pack) {
            for (const field of requiredStringFields) {
                assert.ok(
                    typeof item[field] === 'string' && item[field].length > 0,
                    `[${packName}][${item.id}] missing field: ${field}`,
                );
            }
        }
    }
});

// --- boolean check ---

test('every expected_should_redirect is a boolean', () => {
    for (const packName of ['skincare_xhs', 'makeup_xhs', 'saas_b2b']) {
        const pack = loadEvalPack(packName);
        for (const item of pack) {
            assert.equal(
                typeof item.expected_should_redirect,
                'boolean',
                `[${packName}][${item.id}] expected_should_redirect must be boolean`,
            );
        }
    }
});

// --- scenario allowlist ---

test('every scenario is in the allowed set', () => {
    const allowed = new Set<string>(ALLOWED_SCENARIOS);
    for (const packName of ['skincare_xhs', 'makeup_xhs', 'saas_b2b']) {
        const pack = loadEvalPack(packName);
        for (const item of pack) {
            assert.ok(
                allowed.has(item.scenario),
                `[${packName}][${item.id}] invalid scenario: "${item.scenario}"`,
            );
        }
    }
});

// --- industry-specific content tests ---

test('skincare pack includes sensitivity/safety comments', () => {
    const pack = loadEvalPack('skincare_xhs');
    const safetyCues = ['敏感', '过敏', '孕妇', '宝宝', '闷痘'];
    const hasSafety = pack.some((item) =>
        safetyCues.some((cue) => item.comment_text.includes(cue)),
    );
    assert.ok(hasSafety, 'skincare pack should include sensitivity/safety comments');
});

test('makeup pack includes shade/suitability comments', () => {
    const pack = loadEvalPack('makeup_xhs');
    const shadeCues = ['色号', '黄皮', '冷白皮', '适合', '暗沉', '显'];
    const hasShade = pack.some((item) =>
        shadeCues.some((cue) => item.comment_text.includes(cue)),
    );
    assert.ok(hasShade, 'makeup pack should include shade/suitability comments');
});

test('SaaS pack includes security/integration comments', () => {
    const pack = loadEvalPack('saas_b2b');
    const secCues = ['encrypted', 'GDPR', 'Slack', 'SSO', 'data', 'integration', 'Salesforce', 'security'];
    const hasSec = pack.some((item) =>
        secCues.some((cue) => item.comment_text.toLowerCase().includes(cue.toLowerCase())),
    );
    assert.ok(hasSec, 'SaaS pack should include security/integration comments');
});

// --- summary tests ---

test('summarizeEvalPack returns by_scenario counts', () => {
    const pack = loadAndValidate('skincare_xhs');
    const summary = summarizeEvalPack(pack);

    assert.ok(typeof summary.by_scenario === 'object');
    const scenarioTotal = Object.values(summary.by_scenario).reduce((a, b) => a + b, 0);
    assert.equal(scenarioTotal, 30);
});

test('summarizeEvalPack returns by_expected_strategy counts', () => {
    const pack = loadAndValidate('makeup_xhs');
    const summary = summarizeEvalPack(pack);

    assert.ok(typeof summary.by_expected_strategy === 'object');
    const stratTotal = Object.values(summary.by_expected_strategy).reduce((a, b) => a + b, 0);
    assert.equal(stratTotal, 30);
});

test('summarizeEvalPack total matches pack length', () => {
    for (const packName of ['skincare_xhs', 'makeup_xhs', 'saas_b2b']) {
        const pack = loadAndValidate(packName);
        const summary = summarizeEvalPack(pack);
        assert.equal(summary.total, 30, `total mismatch for pack: ${packName}`);
    }
});

// --- error handling ---

test('invalid pack name throws clear error', () => {
    assert.throws(
        () => loadEvalPack('nonexistent_industry'),
        (err: unknown) => {
            assert.ok(err instanceof Error);
            assert.ok(
                err.message.includes('Unknown eval pack'),
                `Expected "Unknown eval pack" in error, got: ${err.message}`,
            );
            return true;
        },
    );
});

// --- validateEvalPack rejects bad data ---

test('validateEvalPack rejects pack with wrong count', () => {
    assert.throws(
        () => validateEvalPack([]),
        (err: unknown) => {
            assert.ok(err instanceof Error);
            assert.ok(err.message.includes('exactly 30'));
            return true;
        },
    );
});

test('validateEvalPack rejects item with invalid scenario', () => {
    const pack = loadEvalPack('skincare_xhs').map((item, i) =>
        i === 0 ? { ...item, scenario: 'not_a_real_scenario' as any } : item,
    );
    assert.throws(() => validateEvalPack(pack), /invalid scenario/);
});

test('validateEvalPack rejects item with non-boolean expected_should_redirect', () => {
    const pack = loadEvalPack('skincare_xhs').map((item, i) =>
        i === 0 ? { ...item, expected_should_redirect: 'yes' as any } : item,
    );
    assert.throws(() => validateEvalPack(pack), /expected_should_redirect must be boolean/);
});

// --- product_context validation ---

test('validateEvalPack rejects item with non-object product_context', () => {
    const pack = loadEvalPack('skincare_xhs').map((item, i) =>
        i === 0 ? { ...item, product_context: 'not-an-object' as any } : item,
    );
    assert.throws(() => validateEvalPack(pack), /product_context must be an object/);
});

test('validateEvalPack rejects item with array product_context', () => {
    const pack = loadEvalPack('skincare_xhs').map((item, i) =>
        i === 0 ? { ...item, product_context: [] as any } : item,
    );
    assert.throws(() => validateEvalPack(pack), /product_context must be an object/);
});

test('validateEvalPack rejects item with non-array knowledge_context', () => {
    const pack = loadEvalPack('skincare_xhs').map((item, i) =>
        i === 0 ? { ...item, knowledge_context: {} as any } : item,
    );
    assert.throws(() => validateEvalPack(pack), /knowledge_context must be an array/);
});

test('all fixture items have product_context', () => {
    for (const packName of ['skincare_xhs', 'makeup_xhs', 'saas_b2b']) {
        const pack = loadEvalPack(packName);
        for (const item of pack) {
            assert.ok(
                item.product_context !== undefined,
                `[${packName}][${item.id}] missing product_context`,
            );
            assert.equal(
                typeof item.product_context,
                'object',
                `[${packName}][${item.id}] product_context must be an object`,
            );
        }
    }
});

// --- detectUnsupportedFacts tests ---

const SKINCARE_CTX = {
    name: 'LUMIÈRE Glow Serum',
    ingredients_summary: ['peptides', 'ceramides', 'hyaluronic acid'],
    free_from: ['alcohol', 'fragrance'],
    not_claimed: ['acne treatment', 'pregnancy safe', 'medical treatment'],
    unknowns: ['SPF value', 'PA rating', 'exact shelf life'],
};

const MAKEUP_CTX = {
    name: 'VELVET Air Lip Tint',
    claims: ['daily wearable', 'medium pigmentation'],
    not_claimed: ['waterproof', 'transfer-proof', '8-hour wear'],
    unknowns: ['exact wear time', 'full shade range', 'competitor comparison data'],
};

const SAAS_CTX = {
    name: 'FlowDesk',
    integrations: ['Google Drive'],
    not_supported: ['native Slack integration', 'mobile app'],
    security: { encryption_in_transit: true, encryption_at_rest: 'unknown', gdpr: 'not confirmed' },
    pricing: { free_trial: '14 days', starting_price: '$19/user/month', annual_discount: 'unknown' },
    unknowns: ['data residency country', 'Salesforce integration', 'SSO support'],
};

test('detectUnsupportedFacts returns empty for a grounded skincare reply', () => {
    const result = detectUnsupportedFacts(
        '这款精华含有神经酰胺和透明质酸，质地温和，建议敏感肌先局部测试。',
        SKINCARE_CTX,
    );
    assert.equal(result.unsupported_fact_count, 0);
    assert.deepEqual(result.unsupported_facts, []);
});

test('detectUnsupportedFacts flags SPF claim when SPF is unknown', () => {
    const result = detectUnsupportedFacts(
        '这款精华防晒值SPF50，适合日间使用。',
        SKINCARE_CTX,
    );
    assert.ok(result.unsupported_fact_count > 0, 'Expected at least one unsupported fact');
    assert.ok(
        result.unsupported_facts.some((f) => f.toLowerCase().includes('spf')),
        `Expected SPF fact, got: ${JSON.stringify(result.unsupported_facts)}`,
    );
});

test('detectUnsupportedFacts flags niacinamide claim when not in ingredients', () => {
    const result = detectUnsupportedFacts(
        '这款精华富含烟酰胺，可以美白提亮。',
        SKINCARE_CTX,
    );
    assert.ok(result.unsupported_fact_count > 0);
    assert.ok(result.unsupported_facts.some((f) => f.includes('烟酰胺') || f.includes('niacinamide')));
});

test('detectUnsupportedFacts flags pregnancy safe claim when in not_claimed', () => {
    const result = detectUnsupportedFacts(
        '孕妇可以用，成分非常安全，pregnancy safe，无需担心。',
        SKINCARE_CTX,
    );
    assert.ok(result.unsupported_fact_count > 0);
    assert.ok(result.unsupported_facts.some((f) => f.toLowerCase().includes('pregnancy')));
});

test('detectUnsupportedFacts returns empty for a grounded makeup reply', () => {
    const result = detectUnsupportedFacts(
        'This lip tint offers medium pigmentation and a soft matte finish, great for daily wear.',
        MAKEUP_CTX,
    );
    assert.equal(result.unsupported_fact_count, 0);
});

test('detectUnsupportedFacts flags wear time duration when listed as unknown', () => {
    const result = detectUnsupportedFacts(
        'This lip tint lasts 8-10 hours and stays vibrant all day.',
        MAKEUP_CTX,
    );
    assert.ok(result.unsupported_fact_count > 0);
    assert.ok(result.unsupported_facts.some((f) => f.toLowerCase().includes('wear time')));
});

test('detectUnsupportedFacts flags waterproof claim when in not_claimed', () => {
    const result = detectUnsupportedFacts(
        'This lip tint is fully waterproof and transfer-proof.',
        MAKEUP_CTX,
    );
    assert.ok(result.unsupported_fact_count > 0);
    assert.ok(result.unsupported_facts.some((f) => f.toLowerCase().includes('waterproof')));
});

test('detectUnsupportedFacts returns empty for a grounded SaaS reply', () => {
    const result = detectUnsupportedFacts(
        'FlowDesk supports team workspaces with role-based access and CSV export. It integrates with Google Drive.',
        SAAS_CTX,
    );
    assert.equal(result.unsupported_fact_count, 0);
});

test('detectUnsupportedFacts flags Slack integration when not in integrations', () => {
    const result = detectUnsupportedFacts(
        'Yes, FlowDesk connects directly with Slack for real-time notifications.',
        SAAS_CTX,
    );
    assert.ok(result.unsupported_fact_count > 0);
    assert.ok(result.unsupported_facts.some((f) => f.toLowerCase().includes('slack')));
});

test('detectUnsupportedFacts flags mobile app when in not_supported', () => {
    const result = detectUnsupportedFacts(
        'You can download our mobile app on iOS and Android.',
        SAAS_CTX,
    );
    assert.ok(result.unsupported_fact_count > 0);
    assert.ok(result.unsupported_facts.some((f) => f.toLowerCase().includes('mobile app')));
});

test('detectUnsupportedFacts flags encrypted at rest when unknown', () => {
    const result = detectUnsupportedFacts(
        'All your data is encrypted at rest using AES-256.',
        SAAS_CTX,
    );
    assert.ok(result.unsupported_fact_count > 0);
    assert.ok(result.unsupported_facts.some((f) => f.toLowerCase().includes('encrypted at rest')));
});

test('detectUnsupportedFacts flags GDPR compliant when not confirmed', () => {
    const result = detectUnsupportedFacts(
        'FlowDesk is fully GDPR compliant and meets all EU data protection requirements.',
        SAAS_CTX,
    );
    assert.ok(result.unsupported_fact_count > 0);
    assert.ok(result.unsupported_facts.some((f) => f.toLowerCase().includes('gdpr')));
});

// --- negation-aware detection tests (P10.1b) ---

test('isNegatedMention returns true for Chinese prefix negation 不含', () => {
    assert.equal(isNegatedMention('这款产品不含烟酰胺成分', '烟酰胺'), true);
});

test('isNegatedMention returns true for Chinese multi-char negation 没有', () => {
    assert.equal(isNegatedMention('产品里没有烟酰胺', '烟酰胺'), true);
});

test('isNegatedMention returns false when keyword appears without negation', () => {
    assert.equal(isNegatedMention('这款精华富含烟酰胺，可以美白提亮', '烟酰胺'), false);
});

test('detectUnsupportedFacts does not flag negated niacinamide (不含烟酰胺)', () => {
    const result = detectUnsupportedFacts(
        '这款精华不含烟酰胺，主要成分是透明质酸和神经酰胺。',
        SKINCARE_CTX,
    );
    assert.equal(result.unsupported_fact_count, 0, `Expected no facts, got: ${JSON.stringify(result.unsupported_facts)}`);
});

test('detectUnsupportedFacts does not flag negated niacinamide (没有烟酰胺)', () => {
    const result = detectUnsupportedFacts(
        '产品配方里没有烟酰胺成分，主要是透明质酸。',
        SKINCARE_CTX,
    );
    assert.equal(result.unsupported_fact_count, 0, `Expected no facts, got: ${JSON.stringify(result.unsupported_facts)}`);
});

test('detectUnsupportedFacts does not flag negated Slack integration', () => {
    const result = detectUnsupportedFacts(
        "FlowDesk doesn't have a native integration with Slack at this time.",
        SAAS_CTX,
    );
    assert.equal(result.unsupported_fact_count, 0, `Expected no facts, got: ${JSON.stringify(result.unsupported_facts)}`);
});

test('detectUnsupportedFacts does not flag negated mobile app claim', () => {
    const result = detectUnsupportedFacts(
        "Currently there isn't a dedicated mobile app, but the web interface is mobile-optimised.",
        SAAS_CTX,
    );
    assert.equal(result.unsupported_fact_count, 0, `Expected no facts, got: ${JSON.stringify(result.unsupported_facts)}`);
});

test('detectUnsupportedFacts does not flag negated Salesforce claim', () => {
    const result = detectUnsupportedFacts(
        "FlowDesk does not directly integrate with Salesforce — that information isn't confirmed.",
        SAAS_CTX,
    );
    assert.equal(result.unsupported_fact_count, 0, `Expected no facts, got: ${JSON.stringify(result.unsupported_facts)}`);
});

test('detectUnsupportedFacts does not flag negated GDPR claim', () => {
    const result = detectUnsupportedFacts(
        'GDPR compliance is not confirmed in our current product documentation.',
        SAAS_CTX,
    );
    assert.equal(result.unsupported_fact_count, 0, `Expected no facts, got: ${JSON.stringify(result.unsupported_facts)}`);
});

test('detectUnsupportedFacts flags GDPR compliance phrase when GDPR not confirmed', () => {
    const result = detectUnsupportedFacts(
        'Yes, we prioritize GDPR compliance and fully meet EU data regulations.',
        SAAS_CTX,
    );
    assert.ok(result.unsupported_fact_count > 0);
    assert.ok(result.unsupported_facts.some((f) => f.toLowerCase().includes('gdpr')));
});

test('detectUnsupportedFacts flags data residency location when listed as unknown', () => {
    const result = detectUnsupportedFacts(
        'Your data is stored primarily in the United States on AWS servers.',
        SAAS_CTX,
    );
    assert.ok(result.unsupported_fact_count > 0);
    assert.ok(result.unsupported_facts.some((f) => f.toLowerCase().includes('data residency')));
});

test('detectUnsupportedFacts does not flag negated data residency', () => {
    const result = detectUnsupportedFacts(
        'Data residency country is not confirmed in the product details we have.',
        SAAS_CTX,
    );
    assert.equal(result.unsupported_fact_count, 0, `Expected no facts, got: ${JSON.stringify(result.unsupported_facts)}`);
});

test('detectUnsupportedFacts still flags positive Slack claim (negation-aware regression)', () => {
    const result = detectUnsupportedFacts(
        'Great news — FlowDesk integrates directly with Slack for instant team notifications.',
        SAAS_CTX,
    );
    assert.ok(result.unsupported_fact_count > 0);
    assert.ok(result.unsupported_facts.some((f) => f.toLowerCase().includes('slack')));
});

test('detectUnsupportedFacts still flags positive mobile app claim (negation-aware regression)', () => {
    const result = detectUnsupportedFacts(
        'FlowDesk has a mobile app available on both iOS and Android.',
        SAAS_CTX,
    );
    assert.ok(result.unsupported_fact_count > 0);
    assert.ok(result.unsupported_facts.some((f) => f.toLowerCase().includes('mobile app')));
});

test('detectUnsupportedFacts flags Salesforce integration when listed as unknown', () => {
    const result = detectUnsupportedFacts(
        'FlowDesk integrates seamlessly with Salesforce for CRM syncing.',
        SAAS_CTX,
    );
    assert.ok(result.unsupported_fact_count > 0);
    assert.ok(result.unsupported_facts.some((f) => f.toLowerCase().includes('salesforce')));
});
