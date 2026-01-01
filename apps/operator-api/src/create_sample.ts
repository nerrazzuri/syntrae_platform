
import { PrismaClient } from '@syntrae/prisma-schema';


const prisma = new PrismaClient();

async function main() {
    const brand = await prisma.brand.findFirst();
    if (!brand) {
        console.log("No brands found. Create a brand first.");
        return;
    }

    console.log(`Seeding profile for Brand: ${brand.name} (${brand.id})`);

    await prisma.marketProfile.create({
        data: {
            brand_id: brand.id,
            name: "Summer Skincare Focus",
            status: "READY",
            primary_category: "SKINCARE",
            target_audience: "Women 18-35 looking for organic acne treatments and vitamin C serums.",
            languages: ["en"],
            keywords_positive: ["vitamin c", "acne", "glow", "organic", "serum", "routine"],
            keywords_negative: ["pyramid scheme", "mlm", "guaranteed cash", "cheap"],
            hashtags_positive: ["#skincare", "#glowup", "#clearskin"],
            hashtags_negative: ["#giveaway", "#ad"],
            discovery_intent: "BALANCED",
            quality_score: 0.85,
            is_active: true // Make it active immediately for them
        }
    });

    console.log("Done! Profile created.");
}

main()
    .catch(e => console.error(e))
    .finally(() => prisma.$disconnect());
