# XHS Sunglasses Reply Quality — Eval Baseline v8

**Date:** 2026-05-24
**Branch:** main
**Commit:** 438605d
**Eval set:** 50 feedback records, EDITED_BEFORE_SEND + REJECTED, xiaohongshu / SUNGLASS brand
**Prompt version:** v2_strategy_platform_profile

---

## Key Metrics

| Metric | v5 | v6 | v7 | **v8** |
|--------|----|----|-----|--------|
| Non-suit 镜框宽度 | 10/13 | 11/13 | 8/11 | **0/11** |
| Non-suit 镜片大小 | — | — | 4/11 | **0/11** |
| True-suit 镜框宽度 | — | — | 39/39 | **22/39** |
| True-suit 镜片大小 | — | — | 32/39 | **21/39** |
| All 穿搭 injection | — | — | 23/50 | **8/50** |
| All avg length (chars) | — | — | 79 | **64** |

---

## What Changed in v8

**Phase 1 (v5):** Content-based override for stored `FIT_SUITABILITY` intent — product/brand/purchase
comments no longer trigger suitability advice mode.

**Phase 2 (v8):** Extended override to `general_interest` intent (null/unknown stored intent +
non-weak buyer_stage). Added `_is_face_suitability()` to upgrade genuine face-shape questions from
`general_interest` → `suitability_advice`.

Result: all 11 non-suitability eval cases are now clean. The true-suitability group is also less
repetitive (22/39 vs 39/39 for 镜框宽度), meaning factors appear only when contextually relevant.

---

## Test Suite

**74 tests pass** across:
- `tests/test_reply_strategy_adapter.py` — unit tests for intent routing and override logic
- `tests/test_draft_service_prompt_v2.py` — prompt construction and field-presence tests

New in v8: 9 tests (7 adapter + 2 draft service) covering null-intent + EVALUATING cases and the
`_is_face_suitability()` upgrade path.

---

## Non-Suitability Case Classification (11 cases)

Comments classified by keyword match on: brand/product/feature/link/shipping/value terms.

All 11 confirmed clean in v8 draft output (no 镜框宽度 or 镜片大小 present).

| # | Comment | Category |
|---|---------|----------|
| 1 | 请教一下，如果有些目镜上面写着防uv uv400但是一问不是偏光镜，这种还要买吗？ | product feature |
| 2 | 这个墨镜有防晒效果吗？ | product feature |
| 3 | 这是什么品牌呀？ | brand info |
| 4 | 主页没看到链接，是哪一款？ | link request |
| 5 | 可以私信链接吗？ | link request |
| 6 | 这款还有现货吗？ | availability |
| 7 | 有黑色吗？ | color availability |
| 8 | 有茶色镜片吗？ | color availability |
| 9 | 这款有近视夹片吗？ | product feature |
| 10 | 可以配度数吗？ | product feature |
| 11 | 马来西亚可以寄吗？ | shipping |

---

## Known Remaining Quality Gaps (not diagnostic injection)

These are separate from Phase 1/2 scope and require product-context data or further tuning:

1. **Product accuracy**: AI cannot verify product-specific claims (e.g. near-sighted clip-on
   availability, exact UV specs). Answers hedge to "详情页" which is correct but less satisfying
   than human gold.

2. **Over-technical suitability**: General recommendation questions ("推荐一款日常的", "通勤戴呢")
   still trigger full diagnostic factor lists. Gold is more concise and practical. Low priority —
   these are not diagnostic leakage into wrong intent cases.

3. **Emoji / filler phrases**: Light use of emoji and closing questions in some non-suit replies.
   GLOBAL_FORBIDDEN_PHRASES covers the worst offenders; residual cases are within acceptable range.

---

## Eval Script

```
cd apps/operator-api
npx tsx scripts/replay_draft_eval.ts --out eval_out_vN.json
```

Output files `eval_out_v*.json` are not committed (gitignored).
