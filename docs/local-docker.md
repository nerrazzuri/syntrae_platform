# Local Docker Test Stack

Use this to test feature branches locally without touching the live VPS stack.

## 1. Hostnames

Add these entries to your Windows hosts file (`C:\Windows\System32\drivers\etc\hosts`):

```text
127.0.0.1 app.localhost.com
127.0.0.1 api.localhost.com
```

The local nginx edge listens on:

```text
https://app.localhost.com:8443
https://api.localhost.com:8443
```

## 2. Environment

Local Docker reads the repo-root `.env.local` file.

If you want real AI calls locally, set:

```env
LOCAL_OPENAI_API_KEY=your_test_key
```

Leave it blank for UI/API/database testing without live model calls.

## 3. Start

From `infra/compose`:

```bash
docker compose --env-file ../../.env.local \
  -f docker-compose.yml \
  -f docker-compose.catalog-local.yml \
  up -d --build postgresql redis qdrant ai-core ingestion-service operator-api operator-ui nginx
```

Apply feature-branch migrations:

```bash
docker compose --env-file ../../.env.local \
  -f docker-compose.yml \
  -f docker-compose.catalog-local.yml \
  exec -T postgresql psql -U superuser -d syntrae_core \
  < ../../packages/prisma-schema/migrations/20260406143000_product_catalog_post_context/migration.sql
```

## 4. Stop

```bash
docker compose --env-file ../../.env.local \
  -f docker-compose.yml \
  -f docker-compose.catalog-local.yml \
  down
```

To wipe local test data:

```bash
docker compose --env-file ../../.env.local \
  -f docker-compose.yml \
  -f docker-compose.catalog-local.yml \
  down -v
```

## Notes

- Local volumes are named `syntrae_local_*` and are separate from the VPS `/mnt/data` mounts.
- Local nginx exposes only `8080`, `8443`, `15432`, `16379`, and `16333`.
- Stripe is disabled by default through manual billing mode.
