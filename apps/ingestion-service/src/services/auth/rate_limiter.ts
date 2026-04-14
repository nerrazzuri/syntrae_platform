
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
        try {
            const ttl = await redis.ttl(blockKey);
            if (ttl <= 0) return;
            const waitMin = Math.max(1, Math.ceil(ttl / 60));
            throw new Error(`Too many attempts. Please try again in ${waitMin} minutes.`);
        } catch (error: any) {
            if (String(error?.message || '').startsWith('Too many attempts.')) {
                throw error;
            }
            console.warn(`[RateLimit] Redis check failed for IP ${ip}; allowing request.`, error?.message || error);
        }
    }

    /**
     * Record a failed attempt
     */
    static async recordFail(ip: string): Promise<void> {
        const redis = getRedisClient();
        const failKey = this.failKey(ip);
        try {
            const attempts = await redis.incr(failKey);
            if (attempts === 1) {
                await redis.expire(failKey, this.WINDOW_SECONDS);
            }

            if (attempts >= this.MAX_ATTEMPTS) {
                await redis.set(this.blockKey(ip), '1', 'EX', this.BLOCK_SECONDS);
                console.warn(`[RateLimit] Blocked IP ${ip} for ${this.BLOCK_SECONDS}s`);
            }
        } catch (error: any) {
            console.warn(`[RateLimit] Redis fail-record failed for IP ${ip}; continuing auth flow.`, error?.message || error);
        }
    }

    /**
     * Reset on success
     */
    static async reset(ip: string): Promise<void> {
        const redis = getRedisClient();
        try {
            await redis.del(this.failKey(ip), this.blockKey(ip));
        } catch (error: any) {
            console.warn(`[RateLimit] Redis reset failed for IP ${ip}; continuing.`, error?.message || error);
        }
    }
}
