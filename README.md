# Syntrae Platform

This requires Docker and Docker Compose.

## 🗄️ Database Migrations

This platform uses a dedicated service for running Prisma migrations. The application containers (Node.js/Python) **do not** run migrations automatically on startup.

**To migrate the database:**

1.  Start the infrastructure (Postgres):
    ```bash
    docker compose up -d postgresql
    ```

2.  Run the migration service:
    ```bash
    # Check infra/compose folder
    cd infra/compose
    
    # Run ephemeral migration container
    docker compose run --rm db-migrate
    ```

    This will:
    *   Connect to the database
    *   Apply any pending migrations from `packages/prisma-schema/prisma/migrations`
    *   Exit automatically

3.  Start the rest of the stack:
    ```bash
    docker compose up -d
    ```

## Automation Worker

The production worker service is defined in [infra/compose/docker-compose.yml](/home/liang-kai-feng/.gemini/antigravity/scratch/syntrae_platform-main/infra/compose/docker-compose.yml).

- `automation-worker` is now intended to scale horizontally, so it should not use a fixed `container_name`.
- Each replica derives a unique worker id from `AUTOMATION_WORKER_ID` or the container hostname.
- Brand-scoped browser sessions should live under:
  ```text
  /data/storage/sessions/<brand_id>/<platform>/session.json
  ```
- You can capture a brand-scoped session with:
  ```bash
  python main_automation.py login --platform xiaohongshu --brand-id <brand_id>
  ```

## Python Services (AI Core)
Python services treat the database as **Read/Write**, but they do **not** own the schema. They expect the schema to be pre-created by the `db-migrate` service.
