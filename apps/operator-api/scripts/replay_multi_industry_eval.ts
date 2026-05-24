/**
 * Replay eval script for multi-industry eval packs (P10).
 *
 * Usage:
 *   npx tsx scripts/replay_multi_industry_eval.ts --pack skincare_xhs
 *   npx tsx scripts/replay_multi_industry_eval.ts --pack makeup_xhs --out eval_out_makeup.json
 *   npx tsx scripts/replay_multi_industry_eval.ts --pack saas_b2b --out eval_out_saas.json
 *
 * By default this script runs in dry-run mode: it loads and validates the fixture,
 * prints a scenario summary, and exits. It does NOT create real leads or post replies.
 *
 * To enable full draft generation (requires live ai-core and dev DB), set:
 *   EVAL_PERSIST=true
 */

import fs from 'node:fs';
import path from 'node:path';
import {
    loadEvalPack,
    validateEvalPack,
    summarizeEvalPack,
} from '../src/services/multiIndustryEval.service';

function parseArgs() {
    const args = process.argv.slice(2);
    const get = (flag: string) => {
        const i = args.indexOf(flag);
        return i >= 0 ? args[i + 1] : undefined;
    };
    return {
        pack: get('--pack'),
        out: get('--out'),
        persist: process.env.EVAL_PERSIST === 'true',
    };
}

function printSummary(packName: string) {
    const pack = loadEvalPack(packName);
    validateEvalPack(pack);
    const summary = summarizeEvalPack(pack);

    console.log(`\n[MultiIndustryEval] Pack: ${packName}`);
    console.log(`  Industry : ${summary.industry}`);
    console.log(`  Platform : ${summary.platform}`);
    console.log(`  Total    : ${summary.total}`);
    console.log('  By scenario:');
    for (const [scenario, count] of Object.entries(summary.by_scenario).sort()) {
        console.log(`    ${scenario.padEnd(22)} ${count}`);
    }
    console.log('  By expected strategy:');
    for (const [strategy, count] of Object.entries(summary.by_expected_strategy).sort()) {
        console.log(`    ${strategy.padEnd(22)} ${count}`);
    }
    console.log(`  Purchase intent items : ${summary.purchase_intent_count}`);
    console.log(`  Safety-sensitive items: ${summary.safety_sensitive_count}`);

    return { pack, summary };
}

async function main() {
    const opts = parseArgs();

    if (!opts.pack) {
        console.error('[MultiIndustryEval] Error: --pack is required.');
        console.error('  Supported packs: skincare_xhs, makeup_xhs, saas_b2b');
        process.exit(1);
    }

    const { pack, summary } = printSummary(opts.pack);

    if (!opts.persist) {
        console.log('\n[MultiIndustryEval] Dry-run mode (EVAL_PERSIST not set).');
        console.log('  Validation passed. No leads created, no drafts generated.');

        if (opts.out) {
            const report = {
                pack: opts.pack,
                summary,
                mode: 'dry_run',
                items: pack.map((item) => ({
                    id: item.id,
                    comment_text: item.comment_text,
                    scenario: item.scenario,
                    expected_reply_strategy: item.expected_reply_strategy,
                    expected_should_redirect: item.expected_should_redirect,
                    product_context: item.product_context ?? null,
                    generated_draft: null,
                })),
            };
            fs.writeFileSync(opts.out, JSON.stringify(report, null, 2), 'utf-8');
            console.log(`[MultiIndustryEval] Dry-run report written to ${opts.out}`);
        }

        console.log('\n[MultiIndustryEval] To generate real drafts, set EVAL_PERSIST=true');
        console.log('  (requires live ai-core and a dev database with brand/lead records)');
        return;
    }

    // Full generation mode — requires live ai-core
    console.log('\n[MultiIndustryEval] EVAL_PERSIST=true: full generation mode not yet implemented.');
    console.log('  Add ai-core integration here when ready (see replay_draft_eval.ts for pattern).');
    process.exit(0);
}

main().catch((err) => {
    console.error('[MultiIndustryEval] Fatal error:', err);
    process.exit(1);
});
