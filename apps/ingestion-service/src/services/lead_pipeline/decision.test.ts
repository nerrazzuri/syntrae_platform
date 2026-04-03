import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildDecision,
    extractTerminalDecision,
    isDeterministicTerminalDecision,
    inferSkipReasonFromBrain,
    normalizeCommentForAi
} from './decision';

test('normal processed comment -> AI terminal result is persisted/extractable', () => {
    const meta = {
        lead_pipeline_outcome: {
            decision: 'QUALIFIED_LEAD'
        }
    };
    assert.equal(extractTerminalDecision(meta), 'QUALIFIED_LEAD');
});

test('blocked limit -> skipped with reason code', () => {
    assert.equal(buildDecision('SKIPPED', 'BLOCKED_LIMIT'), 'SKIPPED_BLOCKED_LIMIT');
});

test('ai timeout/error -> ERROR_<REASON> persisted code', () => {
    assert.equal(buildDecision('ERROR', 'AI_TIMEOUT'), 'ERROR_AI_TIMEOUT');
});

test('malformed normalization -> SKIPPED_<REASON> path', () => {
    const result = normalizeCommentForAi('   ');
    assert.equal(result.ok, false);
    assert.equal(result.normalizationStatus, 'EMPTY_NORMALIZATION');
    assert.equal(result.skipReason, 'EMPTY_TEXT');
});

test('owner cap response -> skip reason is derived', () => {
    const reason = inferSkipReasonFromBrain({
        policy_decisions: {
            explanation: 'Owner Cap Hit: daily_limit',
            trace: {
                cap_reason: 'daily_limit'
            }
        },
        payload: { strategy: 'IGNORE' }
    });
    assert.equal(reason, 'OWNER_CAP');
});

test('legacy IGNORED is not considered deterministic terminal', () => {
    assert.equal(isDeterministicTerminalDecision('IGNORED'), false);
    assert.equal(isDeterministicTerminalDecision('SKIPPED_POLICY_IGNORE'), true);
});
