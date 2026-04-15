import test from 'node:test';
import assert from 'node:assert/strict';

import { TtlLruCache } from '../src/services/brain/runtime/context';
import { BrainResponse } from '../src/services/brain/types';

const sampleResponse = (text: string): BrainResponse => ({
    text,
    strategy: 'ANSWER',
    confidence: 0.9,
    explanation: 'cached',
    decision_trace: {},
    version: 'test',
    cache_hit: false
});

test('brain result cache expires entries after ttl', () => {
    let now = 1_000;
    const cache = new TtlLruCache<BrainResponse>(5, 100, () => now);

    cache.set('a', sampleResponse('first'));
    assert.equal(cache.get('a')?.text, 'first');

    now += 101;
    assert.equal(cache.get('a'), undefined);
    assert.equal(cache.size(), 0);
});

test('brain result cache evicts least recently used entry when full', () => {
    let now = 1_000;
    const cache = new TtlLruCache<BrainResponse>(2, 1_000, () => now);

    cache.set('a', sampleResponse('alpha'));
    now += 1;
    cache.set('b', sampleResponse('beta'));

    // Refresh a so b becomes the LRU entry.
    assert.equal(cache.get('a')?.text, 'alpha');

    now += 1;
    cache.set('c', sampleResponse('gamma'));

    assert.equal(cache.get('a')?.text, 'alpha');
    assert.equal(cache.get('b'), undefined);
    assert.equal(cache.get('c')?.text, 'gamma');
    assert.equal(cache.size(), 2);
});
