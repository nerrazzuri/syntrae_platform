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

cd "$COMPOSE_DIR"

echo "Stopping Syntrae local Docker stack..."
"${COMPOSE[@]}" down "$@"

echo "Local stack stopped."
