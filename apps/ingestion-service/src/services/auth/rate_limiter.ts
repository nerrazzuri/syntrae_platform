
import { getRedisClient } from '../../lib/redis';

export class RateLimitService {
    private static readonly WINDOW_SECONDS = 15 * 60;
    private static readonly MAX_ATTEMPTS = 10;
    private static readonly BLOCK_SECONDS = 30 * 60;
    private static readonly KEY_PREFIX = 'rl:ingestion-service:auth';

    private static failKey(ip: string): string {
        return `${this.KEY_PREFIX}:fail:${ip}`;
    }

    private static blockKey(ip: string): string {
        return `${this.KEY_PREFIX}:block:${ip}`;
    }

    /**
     * Check if IP is allowed. Throws error if blocked.
     */
    static async check(ip: string): Promise<void> {
        const redis = getRedisClient();
        const blockKey = this.blockKey(ip);
        const blocked = await redis.exists(blockKey);
        if (blocked) {
            const ttl = await redis.ttl(blockKey);
            const waitMin = Math.max(1, Math.ceil(ttl / 60));
            throw new Error(`Too many attempts. Please try again in ${waitMin} minutes.`);
        }
    }

    /**
     * Record a failed attempt
     */
    static async recordFail(ip: string): Promise<void> {
        const redis = getRedisClient();
        const failKey = this.failKey(ip);
        const result = await redis
            .multi()
            .incr(failKey)
            .expire(failKey, this.WINDOW_SECONDS)
            .exec();
        const attempts = Number(result?.[0]?.[1] || 0);

        if (!attempts) {
            throw new Error('Rate limit update failed.');
        }

        if (attempts >= this.MAX_ATTEMPTS) {
            await redis.set(this.blockKey(ip), '1', 'EX', this.BLOCK_SECONDS);
            console.warn(`[RateLimit] Blocked IP ${ip} for ${this.BLOCK_SECONDS}s`);
        }
    }

    /**
     * Reset on success
     */
    static async reset(ip: string): Promise<void> {
        const redis = getRedisClient();
        await redis.del(this.failKey(ip), this.blockKey(ip));
    }
}
