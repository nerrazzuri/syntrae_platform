#!/bin/bash

echo "Stopping local Docker environment..."
docker compose -f docker-compose.local.yml --env-file .env.local down

echo "Local environment stopped."
