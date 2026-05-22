# Learning Review Manual QA

This harness creates local/dev demo records for the learning review UI. It is safe by default for non-production environments and tags every record for cleanup.

## Prerequisites

- Local PostgreSQL is running and `DATABASE_URL` points at the dev database.
- Prisma migrations through `ApplyCandidate` have been applied.
- Operator API and Operator UI can run locally.
- You are signed in to the operator UI with an active workspace.

## Seed Demo Data

```bash
pnpm --filter operator-api seed:learning-review-demo
```

Optional inputs:

```bash
SEED_ACCOUNT_ID=workspace_id \
SEED_BRAND_ID=brand_id \
SEED_PLATFORM=xiaohongshu \
pnpm --filter operator-api seed:learning-review-demo
```

Production guard:

```bash
CONFIRM_SEED_LEARNING_REVIEW_DEMO=true pnpm --filter operator-api seed:learning-review-demo
```

Use the confirmation flag only for an explicitly approved non-production database where `NODE_ENV=production` is set by infrastructure.

## Cleanup

```bash
SEED_CLEANUP=true pnpm --filter operator-api seed:learning-review-demo
```

Cleanup deletes only records tagged with:

```json
{
  "demo_seed": true,
  "seed_name": "learning_review_demo"
}
```

Deletion order:

1. `ApplyCandidate`
2. `LearningApplyPlan`
3. `LearningSuggestion`
4. `DraftFeedback`

## Open the UI

Start the apps, then open:

```text
http://localhost:5173/admin/learning-review
```

If you seeded a specific workspace, sign in and switch to that workspace first.

## Seeded Scenarios

- `OPEN` suggestion with no apply plan.
- `ACCEPTED` suggestion with no apply plan.
- `ACCEPTED` suggestion with a `DRAFT` apply plan.
- `ACCEPTED` suggestion with a `REVIEWED` apply plan and `PENDING` candidate.
- `REJECTED` suggestion.

Seeded feedback reasons include:

- `TOO_AI`
- `TOO_SALESY`
- `WRONG_INTENT`
- `PRODUCT_INFO_WRONG`

## Manual QA Checklist

1. Page loads.
2. Summary cards show seeded counts.
3. Queue shows `OPEN`, `ACCEPTED`, and `REJECTED` items.
4. Selecting an item loads detail.
5. Source feedback examples are visible.
6. `OPEN` suggestion can be accepted, rejected, or archived.
7. `ACCEPTED` suggestion can generate an apply plan.
8. `DRAFT` apply plan can be marked reviewed or cancelled.
9. `REVIEWED` apply plan can generate candidates.
10. `PENDING` candidate can be accepted, rejected, or archived.
11. Warning says candidates are inactive.
12. No runtime AI behavior changes occur.
