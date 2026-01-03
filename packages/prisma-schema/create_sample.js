
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const accountId = 'ws-sample-001';
    const brandId = 'brand-sample-001';

    console.log('🌱 Seeding Sample Data...');

    // 1. Account
    await prisma.account.upsert({
        where: { id: accountId },
        update: {},
        create: {
            id: accountId,
            name: 'Sample Workspace',
        },
    });

    // 2. Brand
    await prisma.brand.upsert({
        where: { id: brandId },
        update: {},
        create: {
            id: brandId,
            name: 'Sample Brand',
            domain: 'tiktok.com',
            status: 'ACTIVE',
            account_id: accountId,
        },
    });

    // 3. Market Profile
    await prisma.marketProfile.upsert({
        where: { id: 'profile-sample-001' },
        update: {},
        create: {
            id: 'profile-sample-001',
            brand_id: brandId,
            name: 'Sample Profile',
            description: 'Test Profile',
            keywords: ['tech', 'gadgets'],
            hashtags: ['#tech', '#gadgets'],
            is_active: true,
            version: 1
        }
    });

    console.log(`✅ Data Created.`);
    console.log(`Brand ID: ${brandId}`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
