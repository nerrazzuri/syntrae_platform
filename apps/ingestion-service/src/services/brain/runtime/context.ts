
import { LLMProvider, MockProvider } from '../../llm/provider';
import { OpenAIProvider } from '../../llm/openai';
import { RagClient, MockRagClient } from '../../rag/rag_client';
import { BrainResponse } from '../types';
import { config } from '../../../config';

// ==========================================
// Phase 17: Runtime Concerns
// ==========================================

// 1. Providers
const apiKey = config.openaiApiKey;
export const llmProvider: LLMProvider = (apiKey && apiKey.startsWith('sk-'))
    ? new OpenAIProvider(apiKey)
    : new MockProvider();

export const ragClient: RagClient = new MockRagClient();

// 2. State (Cache & Circuit Breaker)
type CacheEntry<T> = {
    value: T;
    expiresAt: number;
};

class TtlLruCache<T> {
    private readonly store = new Map<string, CacheEntry<T>>();

    constructor(
        private readonly maxEntries: number,
        private readonly ttlMs: number,
        private readonly now: () => number = () => Date.now()
    ) { }

    has(key: string): boolean {
        return this.get(key) !== undefined;
    }

    get(key: string): T | undefined {
        const entry = this.store.get(key);
        if (!entry) return undefined;

        if (entry.expiresAt <= this.now()) {
            this.store.delete(key);
            return undefined;
        }

        // Refresh recency on access.
        this.store.delete(key);
        this.store.set(key, entry);
        return entry.value;
    }

    set(key: string, value: T): void {
        if (this.store.has(key)) {
            this.store.delete(key);
        }

        this.store.set(key, {
            value,
            expiresAt: this.now() + this.ttlMs
        });

        this.pruneExpired();
        this.pruneOverflow();
    }

    clear(): void {
        this.store.clear();
    }

    size(): number {
        this.pruneExpired();
        return this.store.size;
    }

    private pruneExpired(): void {
        const now = this.now();
        for (const [key, entry] of this.store.entries()) {
            if (entry.expiresAt <= now) {
                this.store.delete(key);
            }
        }
    }

    private pruneOverflow(): void {
        while (this.store.size > this.maxEntries) {
            const oldestKey = this.store.keys().next().value;
            if (!oldestKey) break;
            this.store.delete(oldestKey);
        }
    }
}

export const resultCache = new TtlLruCache<BrainResponse>(
    config.brainResultCacheMaxEntries,
    config.brainResultCacheTtlMs
);

export const circuitBreaker = {
    failureCount: 0,
    lastFailureTime: 0,
    // Constants
    FAILURE_THRESHOLD: 3,
    RESET_TIMEOUT: 60000
};

export { TtlLruCache };
