#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$ROOT_DIR/infra/compose"
ENV_FILE="$ROOT_DIR/.env.local"

COMPOSE=(
  docker compose
  --env-file "$ENV_FILE"
  -f docker-compose.yml
  -f docker-compose.catalog-local.yml
)

APP_SERVICES=(
  ai-core
  ingestion-service
  operator-api
  operator-ui
  marketing-ui
  admin-ui
  nginx
  video-detection-engine
  automation-worker
)

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE"
  exit 1
fi

echo "Starting Syntrae local Docker stack..."
cd "$COMPOSE_DIR"

"${COMPOSE[@]}" up -d --build postgresql redis qdrant
"${COMPOSE[@]}" run --rm --build db-migrate
"${COMPOSE[@]}" up -d --build "${APP_SERVICES[@]}"

echo "Local stack is running."
echo "- Operator UI: https://app.localhost.com:8443"
echo "- Operator API health: https://app.localhost.com:8443/api/health"
echo "- Direct local edge HTTP: http://app.localhost.com:8080"
echo "- Postgres: localhost:15432"
echo "- Redis: localhost:16379"
echo "- Qdrant: localhost:16333"
echo
echo "Comment discovery is available from Brands -> Run XHS Discovery."
