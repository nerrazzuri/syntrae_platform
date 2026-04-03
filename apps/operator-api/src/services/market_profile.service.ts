import { prisma, MarketProfile, MarketCategory, MarketProfileStatus, DiscoveryIntent } from '../db';

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
        const { validation_warnings, quality_score } = this.validateProfile(data);

        // Default weights if not provided
        const weight_keyword = data.weight_keyword ?? 0.3;
        const weight_hashtag = data.weight_hashtag ?? 0.2;

        // Calculate acceptance threshold based on intent
        const acceptance_threshold = this.deriveThreshold(data.discovery_intent);

        return prisma.marketProfile.create({
            data: {
                brand_id: brandId,
                ...data,
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
            languages: data.languages ?? existing.languages,
            keywords_positive: data.keywords_positive ?? existing.keywords_positive,
            keywords_negative: data.keywords_negative ?? existing.keywords_negative,
            hashtags_positive: data.hashtags_positive ?? existing.hashtags_positive,
            hashtags_negative: data.hashtags_negative ?? existing.hashtags_negative,
            excluded_topics: data.excluded_topics ?? existing.excluded_topics,
            discovery_intent: data.discovery_intent ?? existing.discovery_intent as DiscoveryIntent,
            weight_keyword: data.weight_keyword ?? existing.weight_keyword,
            weight_hashtag: data.weight_hashtag ?? existing.weight_hashtag,
        };

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
