# Multi-Industry Eval Packs — P10

**Date:** 2026-05-24
**Branch:** feature/evals-p10-multi-industry-packs
**Purpose:** Verify that SyntraeAI reply generation generalises beyond sunglasses/Xiaohongshu
without modifying any generation behaviour.

---

## Why These Industries

| Industry | Why selected |
|----------|--------------|
| **Skincare** | High overlap with sunglasses market (XHS, female-skewing audience, suitability questions common). Key risk: safety/medical claims (孕妇可以用吗, 会不会过敏). |
| **Makeup** | Similar platform and audience. Key risk: shade advice without product data, overconfident skin compatibility claims. |
| **SaaS / B2B** | Different platform (website chat), English-language, no suitability-advice concept — purely product/fit/pricing questions. Tests that reply strategy isn't stuck in XHS assumptions. |

Regulated/unsafe industries (medical treatment, supplements, financial advice, legal, adult,
gambling, weapons) are intentionally excluded until safety guardrails are validated separately.

---

## Fixture Locations

```
apps/operator-api/fixtures/evals/
  skincare_xhs_eval.json   # 30 items, xiaohongshu, Chinese
  makeup_xhs_eval.json     # 30 items, xiaohongshu, Chinese
  saas_b2b_eval.json       # 30 items, website_chat, English
```

Each item shape:

```jsonc
{
  "id": "skincare_xhs_001",
  "industry": "skincare",
  "platform": "xiaohongshu",
  "comment_text": "敏感肌可以用吗？",
  "scenario": "suitability_advice",
  "expected_reply_strategy": "suitability_advice",
  "expected_should_redirect": false,
  "expected_notes": [
    "give honest fit assessment",
    "do not guarantee no reaction",
    "suggest patch test if uncertain"
  ]
}
```

Allowed `scenario` values: `product_question`, `suitability_advice`, `purchase_request`,
`comparison_request`, `objection_or_concern`, `general_interest`.

---

## Scenario Distribution

### Skincare (30 items)

| Scenario | Count |
|----------|-------|
| product_question | 8 |
| suitability_advice | 13 (8 use-case + 5 safety/sensitivity) |
| purchase_request | 5 |
| comparison_request | 2 |
| objection_or_concern | 2 |

### Makeup (30 items)

| Scenario | Count |
|----------|-------|
| product_question | 8 |
| suitability_advice | 12 (8 shade/fit + 4 beginner/use-case) |
| purchase_request | 5 |
| comparison_request | 2 |
| objection_or_concern | 3 |

### SaaS / B2B (30 items)

| Scenario | Count |
|----------|-------|
| product_question | 12 (8 feature + 4 security/integration) |
| suitability_advice | 8 |
| purchase_request | 5 |
| comparison_request | 2 |
| objection_or_concern | 3 |

---

## Expected Behaviour by Industry

### Skincare

- Answer factual questions (ingredients, SPF, volume) directly from product data.
- Do NOT make guaranteed allergy-free or medical claims.
- Use "建议先做局部测试 / 以产品说明为准 / 建议咨询医生" for safety-sensitive questions.
- Pregnancy questions (孕妇可以用吗): flag retinol/salicylic acid risk if present, recommend
  consulting a doctor. Never give definitive medical clearance.
- Do not over-CTA on factual questions.

### Makeup

- Give concrete shade/compatibility verdicts (not generic "depends on your skin tone").
- Do not invent product claims about pigmentation, staying power, or competitor comparisons.
- Beginner questions: honest difficulty assessment, no over-promise.
- No CTA on suitability/shade questions unless user shows purchase intent.

### SaaS / B2B

- Answer each feature/integration/security question directly.
- Do not claim unsupported integrations or features.
- Security/compliance: state known facts, defer legal confirmation to docs/privacy policy. No
  unverifiable security guarantees.
- Pricing: state tier or range, redirect to pricing page for details.
- Objection handling: validate concern, do not dismiss.

---

## Helper Service

```typescript
import {
    loadEvalPack,
    validateEvalPack,
    summarizeEvalPack,
} from './src/services/multiIndustryEval.service';

const pack = loadEvalPack('skincare_xhs');  // or 'makeup_xhs' | 'saas_b2b'
validateEvalPack(pack);                      // throws if invalid
const summary = summarizeEvalPack(pack);
```

---

## How to Run Validation Tests

```bash
# Run only multi-industry eval tests
node --test --import tsx tests/multiIndustryEval.service.test.ts

# Run full operator-api test suite
pnpm --filter operator-api test
```

Expected: **18 tests pass**, no failures.

---

## How to Run Replay Script

```bash
# Dry-run: validates fixture, prints scenario summary, no AI calls
npx tsx scripts/replay_multi_industry_eval.ts --pack skincare_xhs
npx tsx scripts/replay_multi_industry_eval.ts --pack makeup_xhs --out eval_out_makeup.json
npx tsx scripts/replay_multi_industry_eval.ts --pack saas_b2b --out eval_out_saas.json

# Full generation (requires live ai-core + dev DB):
EVAL_PERSIST=true npx tsx scripts/replay_multi_industry_eval.ts --pack skincare_xhs --out eval_out_skincare_full.json
```

The `--out` flag in dry-run mode writes a JSON report with all items and `generated_draft: null`.
Full generation mode is scaffolded but not yet wired to ai-core; see `replay_draft_eval.ts` for
the integration pattern when that step is added.

---

## Metrics to Collect After Generation

Once full generation is enabled and human review runs, record:

| Metric | Description |
|--------|-------------|
| `ACCEPTED_AS_IS` rate | Draft sent without edit |
| `EDITED_BEFORE_SEND` rate | Draft required human edit |
| `REJECTED` rate | Draft discarded entirely |
| `TOO_GENERIC` | Reply lacked specificity |
| `MISSED_USER_QUESTION` | Reply did not address what was asked |
| `UNSAFE_CLAIM` | Reply made medical/legal/security claim without basis |
| `PRODUCT_INFO_WRONG` | Reply stated incorrect product fact |
| `CTA_SHOULD_NOT_BE_INCLUDED` | Reply added CTA on non-purchase intent question |
| Average reply length | Characters per generated draft |

Compare these metrics against the sunglasses/XHS v8 baseline to identify industry-specific gaps.

---

## Acceptance Criteria

- [x] 3 eval packs exist with exactly 30 items each
- [x] All fixture ids unique within each pack
- [x] Required fields present on all items
- [x] `expected_should_redirect` is boolean on all items
- [x] All scenarios are in the allowed set
- [x] Helper service validates and summarises packs
- [x] 18 tests pass
- [x] TypeScript build passes (`pnpm --filter operator-api build`)
- [x] No generation behaviour changes
- [x] No ai-core prompt/QC/strategy changes

---

## P10.1 — Product Context Grounding

**Date:** 2026-05-24
**Branch:** feature/evals-p101-product-context-grounding

### Problem

Initial multi-industry generation eval (run without product context) revealed widespread
hallucination: the LLM invented SPF values, ingredient claims, integrations, and security
guarantees that had no basis in product data. This is not an adapter or QC issue — it is a
missing grounding input.

### Changes

#### `EvalItem` type extensions

```typescript
product_context?: Record<string, unknown>;
knowledge_context?: Array<Record<string, unknown>>;
```

`product_context` is now present on every fixture item. `knowledge_context` is reserved for
future use (FAQ entries, policy excerpts). Both fields are optional and validated by
`validateEvalPack()`.

#### Product contexts added per pack

| Pack | Product | Key unknowns / not_claimed |
|------|---------|---------------------------|
| `skincare_xhs` | LUMIÈRE Glow Serum (30ml, peptides/ceramides/HA) | SPF value, PA rating, pregnancy safe, acne treatment |
| `makeup_xhs` | VELVET Air Lip Tint (shade 03 Rose Brown, soft matte) | exact wear time, waterproof, transfer-proof |
| `saas_b2b` | FlowDesk (workflow SaaS) | native Slack integration, mobile app, encryption at rest, GDPR, Salesforce, SSO |

#### `detectUnsupportedFacts(replyText, productContext)`

New exported function. Given a generated reply and the item's `product_context`, returns:

```typescript
{ unsupported_fact_count: number, unsupported_facts: string[] }
```

Checks (by industry pattern):
- **Skincare**: SPF claim when SPF is unknown; niacinamide/烟酰胺 when not in ingredients; pregnancy safe when in `not_claimed`
- **Makeup**: wear time duration when listed as unknown; waterproof when in `not_claimed`
- **SaaS**: Slack integration when not in integrations; mobile app when in `not_supported`; encrypted at rest when unknown; GDPR compliant when not confirmed; Salesforce when unknown; free trial contradiction

#### Replay script

`replay_multi_industry_eval.ts` now includes `product_context` in the dry-run JSON output
so downstream grading scripts can access it alongside each item.

### Tests

12 new tests added to `multiIndustryEval.service.test.ts` (total: 30 tests):

- 3 `validateEvalPack` tests for `product_context` / `knowledge_context` field validation
- 1 test confirming all 90 fixture items carry `product_context`
- 8 `detectUnsupportedFacts` tests (2 clean-reply baselines + 6 hallucination detections)

### How to Run

```bash
# Run only multi-industry eval tests (30 tests)
node --test --import tsx tests/multiIndustryEval.service.test.ts

# Full operator-api test suite
pnpm --filter operator-api test
```

### Updated Acceptance Criteria

- [x] `EvalItem` type has optional `product_context` and `knowledge_context` fields
- [x] `validateEvalPack()` validates both new fields
- [x] All 90 fixture items carry `product_context`
- [x] `detectUnsupportedFacts()` exported and functional
- [x] 12 new tests pass (30 total)
- [x] TypeScript build passes
- [x] No generation behaviour changes
- [x] No ai-core prompt/QC/strategy changes
