
import { PrismaClient } from '@syntrae/prisma-schema';

const prisma = new PrismaClient();

async function main() {
    console.log("🌱 Seeding Sample Data...");

    const accountId = 'ws-ts-sample-001';
    const brandId = 'brand-ts-sample-001';

    // 1. Account
    await prisma.account.upsert({
        where: { id: accountId },
        update: {},
        create: {
            id: accountId,
            name: "Sample Workspace (TS)",
        }
    });

    // 2. Brand
    const brand = await prisma.brand.upsert({
        where: { id: brandId },
        update: {},
        create: {
            id: brandId,
            name: "Sample Brand (TS)",
            domain: "tiktok.com",
            status: "ACTIVE",
            account_id: accountId
        }
    });

    console.log(`Using Brand: ${brand.name} (${brand.id})`);

    // 3. Market Profile
    const profile = await prisma.marketProfile.upsert({
        where: { id: 'profile-ts-sample-001' },
        update: { is_active: true },
        create: {
            id: 'profile-ts-sample-001',
            brand_id: brand.id,
            name: "Summer Skincare Focus",
            status: "READY",
            primary_category: "SKINCARE",
            target_audience: "Women 18-35 looking for organic acne treatments.",
            languages: ["en"],
            keywords_positive: ["vitamin c", "acne", "glow", "organic"],
            keywords_negative: ["pyramid scheme", "mlm"],
            hashtags_positive: ["#skincare", "#glowup"],
            hashtags_negative: ["#ad"],
            discovery_intent: "BALANCED",
            quality_score: 0.85,
            is_active: true,
            version: 1
        }
    });

    console.log(`✅ Profile Created/Updated: ${profile.name}`);
    console.log(`YOUR BRAND ID: ${brandId}`);
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
