import Redis from 'ioredis';

let client: Redis | null = null;

export function getRedisClient(): Redis {
    if (!client) {
        client = new Redis(process.env.REDIS_URL || 'redis://redis:6379/0', {
            lazyConnect: true,
            maxRetriesPerRequest: 2,
            enableReadyCheck: true,
        });

        client.on('error', (err) => {
            console.error('[Redis] ingestion-service client error:', err.message);
        });
    }

    return client;
}
