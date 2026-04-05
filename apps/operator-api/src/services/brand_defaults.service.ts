import { DiscoveryIntent, MarketCategory, MarketProfileStatus, PolicyMode, PolicyStatus } from '@syntrae/prisma-schema';

function tokenize(value: string) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3);
}

function unique(values: string[]) {
    return Array.from(new Set(values));
}

export class BrandDefaultsService {
    static buildDefaultPolicyInput(brandId: string, version = 1) {
        return {
            brand_id: brandId,
            version,
            status: PolicyStatus.ACTIVE,
            mode: PolicyMode.SAFE,
            enabled: true,
            relevance_min_score: 70,
            intent_min_score: 60,
            max_videos_per_hour: 20,
            max_comments_per_video: 30,
            max_comments_per_hour: 200,
            max_leads_per_day: 30,
            max_source_posts_per_run: 60,
            max_comments_per_source_post: 10,
            cooldown_ms_between_actions: 2500,
            random_jitter_ms: 1500,
            allow_capture_seen_events: true,
            quiet_hours: {},
            platform_limits: {},
            notes: 'Auto-created default policy',
        };
    }

    static buildDefaultMarketProfileInput(brandId: string, brandName: string, domain: string) {
        const brandTokens = tokenize(brandName);
        const domainTokens = domain === 'general' ? [] : tokenize(domain);
        const keywordsPositive = unique([
            ...brandTokens,
            ...domainTokens,
            'review',
            'recommendation',
            'comparison',
        ]).slice(0, 8);

        return {
            brand_id: brandId,
            name: 'Default Market Profile',
            version: 1,
            status: MarketProfileStatus.ACTIVE,
            primary_category: MarketCategory.ECOM_GENERAL,
            target_audience: `People discussing products, reviews, or purchase intent related to ${brandName}.`,
            languages: ['en', 'zh'],
            geo_mode: 'COUNTRY',
            geo_targets: ['MY'],
            geo_strictness: 'BALANCED',
            keywords_positive: keywordsPositive.length >= 3 ? keywordsPositive : ['review', 'recommendation', 'comparison'],
            keywords_negative: ['job', 'hiring', 'crypto'],
            hashtags_positive: brandTokens.slice(0, 3),
            hashtags_negative: ['ad', 'sponsored'],
            excluded_topics: [],
            acceptance_threshold: 0.6,
            weight_keyword: 0.3,
            weight_hashtag: 0.2,
            quality_score: 0.9,
            validation_warnings: [],
            discovery_intent: DiscoveryIntent.BALANCED,
            is_active: true,
        };
    }
}
