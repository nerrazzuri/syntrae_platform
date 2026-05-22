import test from 'node:test';
import assert from 'node:assert/strict';
import {
    DEMO_FEEDBACK_REASONS,
    DEMO_SCENARIOS,
    LEARNING_REVIEW_DEMO_SEED_NAME,
    assertSeedAllowed,
    buildSeedMetadata,
    demoCleanupWhere,
} from '../src/services/learningReviewSeed.service';

test('seed metadata is attached', () => {
    const metadata = buildSeedMetadata({ scenario: 'open_no_plan' });

    assert.equal(metadata.demo_seed, true);
    assert.equal(metadata.seed_name, LEARNING_REVIEW_DEMO_SEED_NAME);
    assert.equal(metadata.scenario, 'open_no_plan');
});

test('cleanup filter only targets demo records', () => {
    const filter = demoCleanupWhere() as any;

    assert.equal(filter.AND.length, 2);
    assert.deepEqual(filter.AND[0], {
        metadata: { path: ['demo_seed'], equals: true },
    });
    assert.deepEqual(filter.AND[1], {
        metadata: { path: ['seed_name'], equals: LEARNING_REVIEW_DEMO_SEED_NAME },
    });
});

test('seed scenarios include required statuses', () => {
    const suggestionStatuses = new Set(DEMO_SCENARIOS.map((scenario) => scenario.suggestionStatus));
    const planStatuses = new Set(DEMO_SCENARIOS.map((scenario) => scenario.planStatus).filter(Boolean));
    const candidateStatuses = new Set(DEMO_SCENARIOS.map((scenario) => scenario.candidateStatus).filter(Boolean));

    assert.ok(suggestionStatuses.has('OPEN'));
    assert.ok(suggestionStatuses.has('ACCEPTED'));
    assert.ok(suggestionStatuses.has('REJECTED'));
    assert.ok(planStatuses.has('DRAFT'));
    assert.ok(planStatuses.has('REVIEWED'));
    assert.ok(candidateStatuses.has('PENDING'));
});

test('seed examples include required feedback reasons', () => {
    const reasons = new Set(DEMO_SCENARIOS.flatMap((scenario) => [...scenario.selectedReasons]));

    for (const requiredReason of DEMO_FEEDBACK_REASONS) {
        assert.ok(reasons.has(requiredReason), `missing ${requiredReason}`);
    }
});

test('production guard blocks unsafe execution', () => {
    assert.throws(
        () => assertSeedAllowed({ nodeEnv: 'production', confirm: '' }),
        /Refusing to seed learning review demo data/,
    );

    assert.doesNotThrow(() => assertSeedAllowed({ nodeEnv: 'production', confirm: 'true' }));
    assert.doesNotThrow(() => assertSeedAllowed({ nodeEnv: 'development', confirm: '' }));
});
