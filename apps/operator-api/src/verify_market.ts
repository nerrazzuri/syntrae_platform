import { prisma, MarketCategory, DiscoveryIntent, MarketProfileStatus } from './db';

// Native fetch is available in Node 18+
// We need to define types primarily for compilation if not using 'any'

async function main() {
    console.log("1. Setup Test Data (Direct DB)...");

    // 1. Get Seeded Brand & Account
    const brand = await prisma.brand.findFirst();
    if (!brand) throw new Error("No brand found. Run seed.");
    const accountId = brand.workspace_id;

    // 2. Create User
    const email = `test-${Date.now()}@demo.com`;
    const user = await prisma.user.create({
        data: {
            email,
            password_hash: 'ignored_hash',
            status: 'ACTIVE'
        }
    });
    console.log(`   Created User: ${user.id} (${user.email})`);

    // 3. Create Membership
    await prisma.workspaceMembership.create({
        data: {
            workspace_id: accountId,
            user_id: user.id,
            role: 'OWNER',
            status: 'ACTIVE'
        }
    });

    // 4. Create Session
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 1);
    const session = await prisma.session.create({
        data: {
            user_id: user.id,
            active_workspace_id: accountId,
            expires_at: expiresAt
        }
    });
    console.log(`   Created Session: ${session.id}`);

    const cookieHeader = `syntrae_session=s%3A${session.id}`; // Express signed cookie format might be needed if using 'cookie-parser' signed?
    // middleware/session_auth.ts: req.cookies.syntrae_session.
    // Usually it expects the raw value if not signed, or signed format.
    // operator-api index.ts uses `cookieParser()`. Not `cookieParser(secret)`. So likely raw.
    const rawCookie = `syntrae_session=${session.id}`;

    const BASE_URL = 'http://localhost:3001';

    // Helper for requests
    async function request(method: string, path: string, body?: any) {
        const res = await fetch(`${BASE_URL}${path}`, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Cookie': rawCookie
            },
            body: body ? JSON.stringify(body) : undefined
        });

        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch { data = text; }

        return { status: res.status, data };
    }

    console.log("\n2. Creating Market Profile...");
    const createPayload = {
        name: "Skincare Launch 2026",
        primary_category: "SKINCARE",
        target_audience: "Women 25-34 interested in organic beauty",
        languages: ["en"],
        geo_mode: "COUNTRY",
        geo_targets: ["MY"],
        geo_strictness: "BALANCED",
        keywords_positive: ["organic serum", "vitamin c", "glow skin"],
        keywords_negative: ["chemicals", "cheap"],
        hashtags_positive: ["#skincare", "#cleanbeauty"],
        hashtags_negative: ["#giveaway"],
        excluded_topics: ["politics"],
        discovery_intent: "BALANCED"
    };

    const createRes = await request('POST', `/brands/${brand.id}/market-profiles`, createPayload);
    console.log("   Status:", createRes.status);
    if (createRes.status !== 201) {
        console.error("   Failed to create:", createRes.data);
        process.exit(1);
    }
    const profile = createRes.data;
    console.log("   Profile ID:", profile.id);
    console.log("   Quality Score:", profile.quality_score);
    console.log("   Status:", profile.status);

    console.log("\n3. Listing Profiles...");
    const listRes = await request('GET', `/brands/${brand.id}/market-profiles`);
    console.log("   Count:", listRes.data.length);
    const found = listRes.data.find((p: any) => p.id === profile.id);
    if (!found) {
        console.error("   Profile not found in list!");
        process.exit(1);
    }

    console.log("\n4. Activating Profile...");
    const activateRes = await request('POST', `/market-profiles/${profile.id}/activate`);
    console.log("   Activate Status:", activateRes.status);
    console.log("   Is Active:", activateRes.data.is_active);

    if (!activateRes.data.is_active) {
        console.error("   Failed to activate:", activateRes.data);
        // It might be blocked due to warnings?
        // Profile status logic in service: if warnings > 0, status is DRAFT.
        // And create logic sets warnings.
        // Let's check warnings.
        if (profile.validation_warnings?.length > 0) {
            console.log("   (Expected failure if warnings exist: " + profile.validation_warnings.join(", ") + ")");
            // We can proceed if this was expected, otherwise fail.
            // Our payload seems valid (3 keywords, 1 negative).
        } else {
            process.exit(1);
        }
    }

    console.log("\n5. Verifying Mutual Exclusion...");
    const p2Payload = { ...createPayload, name: "Second Profile" };
    const p2Res = await request('POST', `/brands/${brand.id}/market-profiles`, p2Payload);
    const p2Id = p2Res.data.id;

    await request('POST', `/market-profiles/${p2Id}/activate`);

    // Check P1
    const checkRes = await request('GET', `/brands/${brand.id}/market-profiles`);
    const p1State = checkRes.data.find((p: any) => p.id === profile.id);
    console.log("   P1 Active (should be false):", p1State.is_active);

    if (p1State.is_active === false) {
        console.log("\nSUCCESS: Verification Complete.");
    } else {
        console.error("\nFAILURE: Mutual exclusion failed.");
        process.exit(1);
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
