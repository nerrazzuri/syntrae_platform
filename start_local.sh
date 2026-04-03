#!/bin/bash

echo "Starting local Docker environment for Xiaohongshu testing..."

# Ensure local-data directories exist so docker doesn't create them as root
mkdir -p ./local-data/postgres
mkdir -p ./local-data/redis
mkdir -p ./local-data/qdrant
mkdir -p ./local-data/ingestion
mkdir -p ./local-data/video
mkdir -p ./local-data/screenshots

# Start the environment
docker compose -f docker-compose.local.yml --env-file .env.local up -d

echo "Environment started successfully! Services exposed:"
echo "- Operator UI: http://localhost:8080"
echo "- Operator API: http://localhost:3001"
echo "- Ingestion Service: http://localhost:3005"
echo "- AI Core API: http://localhost:8000"
