import { prisma, MarketProfile, MarketCategory, MarketProfileStatus, DiscoveryIntent } from '../db';
import { BrandDefaultsService } from './brand_defaults.service';

export interface CreateProfileDTO {
    name: string;
    primary_category: MarketCategory;
    target_audience: string;
    languages: string[];
    keywords_positive: string[];
    keywords_negative: string[];
    hashtags_positive: string[];
    hashtags_negative: string[];
    excluded_topics: string[];
    discovery_intent: DiscoveryIntent;
    weight_keyword?: number;
    weight_hashtag?: number;
}

export interface UpdateProfileDTO extends Partial<CreateProfileDTO> {
    status?: MarketProfileStatus;
    is_active?: boolean;
}

const GENERIC_BANNED_TERMS = ['buy', 'sale', 'cheap', 'promo', 'offer', 'price', 'cost', 'money', 'cash', 'deal', 'discount', 'free'];
const MAX_POSITIVE_KEYWORDS = 3;

// Implicit Category Exclusions (Simple Static Map)
const CATEGORY_EXCLUSIONS: Record<MarketCategory, string[]> = {
    [MarketCategory.SKINCARE]: ['crypto', 'forex', 'loan', 'gambling', 'makeup tutorial'], // Example: Skincare != Makeup
    [MarketCategory.BEAUTY]: ['crypto', 'finance', 'automotive'],
    [MarketCategory.FITNESS]: ['sedentary', 'gaming', 'junk food'],
    [MarketCategory.SAAS]: ['retail', 'fashion', 'beauty', 'recipes'],
    [MarketCategory.EDUCATION]: ['entertainment', 'pranks', 'gaming'],
    [MarketCategory.LOCAL_SERVICE]: ['global', 'digital only', 'software'],
    [MarketCategory.ECOM_GENERAL]: ['service', 'consulting'],
};

export class MarketProfileService {
    private static normalizeList(values: string[] | undefined): string[] {
        const unique = new Set<string>();
        for (const value of values || []) {
            const cleaned = String(value || '').trim();
            if (!cleaned) continue;
            unique.add(cleaned);
        }
        return Array.from(unique);
    }

    private static assertPositiveKeywordLimit(keywords: string[]) {
        if (keywords.length > MAX_POSITIVE_KEYWORDS) {
            throw new Error(`Positive keywords are limited to ${MAX_POSITIVE_KEYWORDS}. Discovery only uses the first ${MAX_POSITIVE_KEYWORDS}.`);
        }
    }

    static async assertBrandAccess(brandId: string, workspaceId: string) {
        const brand = await prisma.brand.findFirst({
            where: { id: brandId, workspace_id: workspaceId },
            select: { id: true }
        });

        if (!brand) {
            throw new Error('Brand not found or access denied');
        }

        return brand;
    }

    static async assertBrandExists(brandId: string) {
        const brand = await prisma.brand.findUnique({
            where: { id: brandId },
            select: { id: true }
        });

        if (!brand) {
            throw new Error('Brand not found');
        }

        return brand;
    }

    static async assertProfileAccess(id: string, workspaceId: string) {
        const profile = await prisma.marketProfile.findFirst({
            where: {
                id,
                brand: {
                    workspace_id: workspaceId
                }
            }
        });

        if (!profile) {
            throw new Error('Profile not found or access denied');
        }

        return profile;
    }

    static async createProfile(brandId: string, workspaceId: string, data: CreateProfileDTO) {
        await this.assertBrandAccess(brandId, workspaceId);
        const normalizedData: CreateProfileDTO = {
            ...data,
            languages: this.normalizeList(data.languages),
            keywords_positive: this.normalizeList(data.keywords_positive),
            keywords_negative: this.normalizeList(data.keywords_negative),
            hashtags_positive: this.normalizeList(data.hashtags_positive),
            hashtags_negative: this.normalizeList(data.hashtags_negative),
            excluded_topics: this.normalizeList(data.excluded_topics),
        };
        this.assertPositiveKeywordLimit(normalizedData.keywords_positive);
        const { validation_warnings, quality_score } = this.validateProfile(normalizedData);

        // Default weights if not provided
        const weight_keyword = normalizedData.weight_keyword ?? 0.3;
        const weight_hashtag = normalizedData.weight_hashtag ?? 0.2;

        // Calculate acceptance threshold based on intent
        const acceptance_threshold = this.deriveThreshold(normalizedData.discovery_intent);

        return prisma.marketProfile.create({
            data: {
                brand_id: brandId,
                ...normalizedData,
                weight_keyword,
                weight_hashtag,
                acceptance_threshold,
                quality_score,
                validation_warnings,
                version: 1,
                status: validation_warnings.length > 0 ? MarketProfileStatus.DRAFT : MarketProfileStatus.READY,
            }
        });
    }

    static async updateProfile(id: string, workspaceId: string, data: UpdateProfileDTO) {
        const existing = await this.assertProfileAccess(id, workspaceId);

        // Merge data for validation
        const merged: CreateProfileDTO = {
            name: data.name ?? existing.name,
            primary_category: data.primary_category ?? existing.primary_category as MarketCategory,
            target_audience: data.target_audience ?? existing.target_audience,
            languages: this.normalizeList(data.languages ?? existing.languages),
            keywords_positive: this.normalizeList(data.keywords_positive ?? existing.keywords_positive),
            keywords_negative: this.normalizeList(data.keywords_negative ?? existing.keywords_negative),
            hashtags_positive: this.normalizeList(data.hashtags_positive ?? existing.hashtags_positive),
            hashtags_negative: this.normalizeList(data.hashtags_negative ?? existing.hashtags_negative),
            excluded_topics: this.normalizeList(data.excluded_topics ?? existing.excluded_topics),
            discovery_intent: data.discovery_intent ?? existing.discovery_intent as DiscoveryIntent,
            weight_keyword: data.weight_keyword ?? existing.weight_keyword,
            weight_hashtag: data.weight_hashtag ?? existing.weight_hashtag,
        };

        this.assertPositiveKeywordLimit(merged.keywords_positive);
        const { validation_warnings, quality_score } = this.validateProfile(merged);

        // Logic for Activation
        if (data.is_active === true) {
            if (validation_warnings.length > 0 && existing.status !== MarketProfileStatus.ACTIVE) {
                throw new Error(`Cannot activate profile with warnings: ${validation_warnings.join(", ")}`);
            }
            // Deactivate others
            await prisma.marketProfile.updateMany({
                where: { brand_id: existing.brand_id, is_active: true, id: { not: id } },
                data: { is_active: false }
            });
        }

        const acceptance_threshold = data.discovery_intent ? this.deriveThreshold(data.discovery_intent) : existing.acceptance_threshold;

        return prisma.marketProfile.update({
            where: { id },
            data: {
                ...data,
                ...(data.languages ? { languages: merged.languages } : {}),
                ...(data.keywords_positive ? { keywords_positive: merged.keywords_positive } : {}),
                ...(data.keywords_negative ? { keywords_negative: merged.keywords_negative } : {}),
                ...(data.hashtags_positive ? { hashtags_positive: merged.hashtags_positive } : {}),
                ...(data.hashtags_negative ? { hashtags_negative: merged.hashtags_negative } : {}),
                ...(data.excluded_topics ? { excluded_topics: merged.excluded_topics } : {}),
                acceptance_threshold,
                quality_score,
                validation_warnings,
                version: { increment: 1 }, // Auto-increment version on edit
                status: (data.is_active || existing.is_active) ? MarketProfileStatus.ACTIVE : (validation_warnings.length > 0 ? MarketProfileStatus.DRAFT : MarketProfileStatus.READY),
            }
        });
    }

    static async getActiveProfile(brandId: string, workspaceId?: string) {
        if (workspaceId) {
            await this.assertBrandAccess(brandId, workspaceId);
        } else {
            await this.assertBrandExists(brandId);
        }
        return prisma.marketProfile.findFirst({
            where: { brand_id: brandId, is_active: true }
        });
    }

    static async getOrCreateActiveProfile(brandId: string, workspaceId?: string) {
        const existing = await this.getActiveProfile(brandId, workspaceId);
        if (existing) {
            return existing;
        }

        return this.createDefaultProfile(brandId, workspaceId);
    }

    static async listProfiles(brandId: string, workspaceId?: string) {
        if (workspaceId) {
            await this.assertBrandAccess(brandId, workspaceId);
        } else {
            await this.assertBrandExists(brandId);
        }
        return prisma.marketProfile.findMany({
            where: { brand_id: brandId },
            orderBy: { updated_at: 'desc' }
        });
    }

    static async createDefaultProfile(brandId: string, workspaceId?: string) {
        if (workspaceId) {
            await this.assertBrandAccess(brandId, workspaceId);
        }

        const brand = await prisma.brand.findUnique({
            where: { id: brandId },
            select: { id: true, name: true, domain: true }
        });

        if (!brand) {
            throw new Error('Brand not found');
        }

        const existing = await prisma.marketProfile.findFirst({
            where: { brand_id: brandId, is_active: true },
            orderBy: { updated_at: 'desc' }
        });
        if (existing) {
            return existing;
        }

        return prisma.marketProfile.create({
            data: BrandDefaultsService.buildDefaultMarketProfileInput(brand.id, brand.name, brand.domain)
        });
    }

    private static deriveThreshold(intent: DiscoveryIntent): number {
        switch (intent) {
            case DiscoveryIntent.CONSERVATIVE: return 0.8;
            case DiscoveryIntent.BALANCED: return 0.6;
            case DiscoveryIntent.AGGRESSIVE: return 0.4;
            default: return 0.6;
        }
    }

    private static validateProfile(data: CreateProfileDTO): { validation_warnings: string[], quality_score: number } {
        const warnings: string[] = [];
        let score = 1.0;

        // 1. Min Keywords
        if (data.keywords_positive.length < 3) {
            warnings.push("Too few positive keywords (min 3)");
            score -= 0.2;
        }

        // 2. Negative Keywords
        if (data.keywords_negative.length < 1) {
            warnings.push("No negative keywords defined (unsafe)");
            score -= 0.3;
        }

        // 3. Generic Keyword Ratio
        const genericCount = data.keywords_positive.filter(k => GENERIC_BANNED_TERMS.some(term => k.toLowerCase().includes(term))).length;
        const ratio = genericCount / (data.keywords_positive.length || 1);
        if (ratio > 0.3) {
            warnings.push("Too many generic keywords (buy, sale, etc.)");
            score -= 0.3;
        }

        // 4. Weight Sum
        const w_k = data.weight_keyword ?? 0.3;
        const w_h = data.weight_hashtag ?? 0.2;
        if (w_k + w_h > 1.0) {
            // Auto-clamping logic could happen, or throw. Let's warn.
            warnings.push("Scoring weights exceed 1.0 sum");
            score -= 0.1;
        }

        // 5. Implicit Exclusion Hints (Soft check)
        // We append the implicit ones in the engine, but here we check if user explicitly contradicts them?
        // Skip for now, engine handles it.

        return { validation_warnings: warnings, quality_score: Math.max(0, score) };
    }
}
