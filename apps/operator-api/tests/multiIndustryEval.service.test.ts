import test from 'node:test';
import assert from 'node:assert/strict';

import {
    loadEvalPack,
    validateEvalPack,
    summarizeEvalPack,
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
