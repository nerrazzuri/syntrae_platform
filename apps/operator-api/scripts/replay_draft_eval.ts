/**
 * Replay evaluation script: re-generates AI drafts for previously reviewed feedback records
 * and produces a side-by-side comparison against the human-edited gold text.
 *
 * Usage:
 *   pnpm --filter operator-api replay:eval
 *   pnpm --filter operator-api replay:eval -- --limit 20 --reasons TOO_GENERIC,MISSED_USER_QUESTION
 *   pnpm --filter operator-api replay:eval -- --out ./eval_results.json
 */

import dotenv from 'dotenv';
import fs from 'node:fs';
import { execSync, spawn } from 'node:child_process';
import path from 'node:path';
import { prisma } from '../src/db';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config();

function applyHostDatabaseFallback() {
    if (fs.existsSync('/.dockerenv')) return;
    if (String(process.env.SEED_DISABLE_LOCAL_DB_FALLBACK || '').toLowerCase() === 'true') return;
    const rawUrl = process.env.DATABASE_URL;
    if (!rawUrl) return;
    try {
        const parsed = new URL(rawUrl);
        if (parsed.hostname !== 'postgresql') return;
        parsed.hostname = 'localhost';
        parsed.port = '15432';
        process.env.DATABASE_URL = parsed.toString();
    } catch { /* leave as-is */ }
}

applyHostDatabaseFallback();

const PROXY_CONTAINER = 'ai-core-eval-proxy';
const PROXY_HOST_PORT = '18010';

function resolveAiCoreUrl(): string {
    // If already explicitly set, use it
    const explicit = process.env.AI_CORE_BASE_URL;
    if (explicit && !explicit.includes('ai-core:')) return explicit;

    // Try to reach the default Docker-internal URL — only works when running inside Docker.
    // When running on the host, start a socat proxy container instead.
    if (fs.existsSync('/.dockerenv')) {
        return 'http://ai-core:8000';
    }

    // Find the Docker network that contains ai-core
    let network = 'syntrae_local_syntrae_net';
    try {
        const out = execSync('docker inspect syntrae-local-ai-core --format {{json .NetworkSettings.Networks}}', { encoding: 'utf-8' });
        const nets = JSON.parse(out.trim());
        network = Object.keys(nets)[0] || network;
    } catch { /* use default */ }

    // Start proxy if not already running
    try {
        execSync(`docker inspect ${PROXY_CONTAINER} --format running`, { stdio: 'pipe' });
        console.log(`[ReplayEval] Reusing existing proxy container on port ${PROXY_HOST_PORT}`);
    } catch {
        console.log(`[ReplayEval] Starting ai-core proxy on localhost:${PROXY_HOST_PORT}...`);
        execSync(
            `docker run --rm -d -p ${PROXY_HOST_PORT}:8000 --network ${network} --name ${PROXY_CONTAINER} alpine/socat TCP-LISTEN:8000,fork,reuseaddr TCP:ai-core:8000`,
            { stdio: 'pipe' },
        );
        // Brief wait for socat to bind
        execSync('ping -n 2 127.0.0.1 > nul 2>&1 || sleep 1', { shell: 'cmd.exe', stdio: 'ignore' });
    }

    return `http://localhost:${PROXY_HOST_PORT}`;
}

function stopProxy() {
    try {
        execSync(`docker stop ${PROXY_CONTAINER}`, { stdio: 'pipe' });
    } catch { /* already gone */ }
}

function parseArgs() {
    const args = process.argv.slice(2);
    const get = (flag: string) => {
        const i = args.indexOf(flag);
        return i >= 0 ? args[i + 1] : undefined;
    };
    return {
        limit: parseInt(get('--limit') || '50', 10),
        reasons: (get('--reasons') || '').split(',').map(r => r.trim()).filter(Boolean),
        out: get('--out') || null,
        feedbackTypes: (get('--types') || 'EDITED_BEFORE_SEND,REJECTED').split(',').map(t => t.trim()),
    };
}

async function callAiCoreGenerate(leadId: string, accountId: string, aiCoreUrl: string, context: {
    commentText: string;
    brandName: string;
    brandDomain: string;
    platform: string;
    buyerStage: string | null;
    intent: string | null;
    productContext: any;
}): Promise<string> {
    const secret = process.env.AI_CORE_INTERNAL_SECRET || '';

    try {
        const res = await fetch(`${aiCoreUrl}/v1/internal/drafts/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Internal-Secret': secret,
                'X-Account-Id': accountId,
            },
            body: JSON.stringify({
                lead_id: leadId,
                account_id: accountId,
                force: true,
                comment_text: context.commentText,
                brand_name: context.brandName,
                brand_domain: context.brandDomain,
                platform: context.platform,
                buyer_stage: context.buyerStage,
                intent: context.intent,
                product_context: context.productContext,
                knowledge_context: [],
            }),
        });

        if (!res.ok) {
            const body = await res.text();
            return `[ERROR ${res.status}] ${body}`;
        }

        const json = await res.json() as any;
        return json?.draft_text || json?.reply || '[no draft_text in response]';
    } catch (err: any) {
        return `[FETCH ERROR] ${err.message}`;
    }
}

type EvalRow = {
    feedback_id: string;
    draft_id: string;
    lead_id: string;
    comment_text: string;
    feedback_type: string;
    selected_reasons: string[];
    feedback_note: string | null;
    original_draft_text: string;
    human_edited_text: string | null;
    new_draft_text: string;
    brand_name: string;
    platform: string;
};

async function main() {
    const opts = parseArgs();
    const aiCoreUrl = resolveAiCoreUrl();

    console.log(`[ReplayEval] ai-core URL: ${aiCoreUrl}`);
    console.log('[ReplayEval] Fetching feedback records...');

    const where: any = {
        feedback_type: { in: opts.feedbackTypes },
    };

    if (process.env.SEED_ACCOUNT_ID) where.account_id = process.env.SEED_ACCOUNT_ID;
    if (process.env.SEED_BRAND_ID) where.brand_id = process.env.SEED_BRAND_ID;

    const db = prisma as any;

    const feedbackRows = await db.draftFeedback.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: opts.limit * 4, // over-fetch to account for client-side filtering
    });

    // Client-side: exclude demo seed records and filter by reasons
    const filtered = feedbackRows.filter((fb: any) => {
        const meta = fb.metadata && typeof fb.metadata === 'object' ? fb.metadata as any : {};
        if (meta.demo_seed === true) return false;
        if (opts.reasons.length === 0) return true;
        const reasons: string[] = Array.isArray(fb.selected_reasons) ? fb.selected_reasons : [];
        return opts.reasons.some(r => reasons.includes(r));
    }).slice(0, opts.limit);

    console.log(`[ReplayEval] Found ${filtered.length} matching records. Re-generating...`);

    // Batch-load outreach drafts and leads to avoid N+1
    const draftIds = [...new Set(filtered.map((fb: any) => fb.outreach_draft_id as string))];
    const drafts = await db.outreachDraft.findMany({
        where: { id: { in: draftIds } },
    });
    const draftMap = new Map(drafts.map((d: any) => [d.id, d]));

    const leadIds = [...new Set(drafts.map((d: any) => d.lead_id as string))];
    const leads = await db.leadOpportunity.findMany({
        where: { id: { in: leadIds } },
        include: { brand: true, event: true, matched_catalog_item: true },
    });
    const leadMap = new Map(leads.map((l: any) => [l.id, l]));

    const results: EvalRow[] = [];
    let done = 0;

    for (const fb of filtered) {
        const draft = draftMap.get(fb.outreach_draft_id);
        if (!draft) {
            console.warn(`\n  [skip] feedback ${fb.id} — draft not found`);
            continue;
        }
        const lead = leadMap.get(draft.lead_id);
        if (!lead) {
            console.warn(`\n  [skip] feedback ${fb.id} — lead not found`);
            continue;
        }

        const productContext = lead.matched_catalog_item ? {
            name: lead.matched_catalog_item.name,
            category: lead.matched_catalog_item.category,
            description: lead.matched_catalog_item.description,
            price_label: lead.matched_catalog_item.price_label,
            key_benefits: lead.matched_catalog_item.key_benefits,
            common_objections: lead.matched_catalog_item.common_objections,
        } : null;

        const newDraftText = await callAiCoreGenerate(lead.id, lead.account_id, aiCoreUrl, {
            commentText: lead.event?.content_text || '',
            brandName: lead.brand?.name || '',
            brandDomain: lead.brand?.domain || '',
            platform: lead.platform || '',
            buyerStage: lead.buyer_stage || null,
            intent: lead.intent || null,
            productContext,
        });

        results.push({
            feedback_id: fb.id,
            draft_id: draft.id,
            lead_id: lead.id,
            comment_text: lead.event?.content_text || '',
            feedback_type: fb.feedback_type,
            selected_reasons: Array.isArray(fb.selected_reasons) ? fb.selected_reasons : [],
            feedback_note: fb.feedback_note || null,
            original_draft_text: fb.original_draft_text || '',
            human_edited_text: fb.human_edited_text || null,
            new_draft_text: newDraftText,
            brand_name: lead.brand?.name || '',
            platform: lead.platform || '',
        });

        done++;
        process.stdout.write(`\r  ${done}/${filtered.length}`);
    }

    console.log('\n[ReplayEval] Done.');

    if (opts.out) {
        fs.writeFileSync(opts.out, JSON.stringify(results, null, 2), 'utf-8');
        console.log(`[ReplayEval] Results written to ${opts.out}`);
    } else {
        printReport(results);
    }
}

function printReport(rows: EvalRow[]) {
    const sep = '─'.repeat(80);
    for (const [i, row] of rows.entries()) {
        console.log(`\n${sep}`);
        console.log(`[${i + 1}/${rows.length}] ${row.platform} | ${row.brand_name}`);
        console.log(`Reasons: ${row.selected_reasons.join(', ') || '—'} | Type: ${row.feedback_type}`);
        if (row.feedback_note) console.log(`Note: ${row.feedback_note}`);
        console.log(`\nCOMMENT:\n  ${row.comment_text}`);
        console.log(`\nORIGINAL AI DRAFT:\n  ${row.original_draft_text}`);
        console.log(`\nNEW AI DRAFT:\n  ${row.new_draft_text}`);
        if (row.human_edited_text) {
            console.log(`\nGOLD (human edited):\n  ${row.human_edited_text}`);
        }
    }
    console.log(`\n${sep}`);
    console.log(`[ReplayEval] ${rows.length} cases compared.`);
}

main()
    .catch((err) => {
        console.error('[ReplayEval] Failed:', err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
        stopProxy();
    });
