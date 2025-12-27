FROM node:20-bullseye

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy workspace config
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Copy packages config
COPY packages/domain-models/package.json packages/domain-models/
COPY packages/prisma-schema/package.json packages/prisma-schema/
COPY packages/shared-config/package.json packages/shared-config/
COPY packages/intent-taxonomy/package.json packages/intent-taxonomy/
COPY packages/llm-contracts/package.json packages/llm-contracts/

# Copy app config
COPY apps/ingestion-service/package.json apps/ingestion-service/

# Install dependencies (only what's needed for this app effectively via lockfile)
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages packages
COPY apps/ingestion-service apps/ingestion-service

# Build Shared Packages (if needed, or pnpm install did it partially)
# For domain-models which has a build script:
RUN pnpm -r --filter ./packages/domain-models build
# For prisma-schema:
RUN pnpm -r --filter ./packages/prisma-schema exec prisma generate

# Build App
WORKDIR /app/apps/ingestion-service
# Update local prisma (if still needed? Package prisma-schema handles client, but app might run migrations?)
# App doesn't have local schema anymore.
# RUN npx prisma generate -> No schema file here.
RUN pnpm run build

# Explicitly copy signals (legacy behavior preservation)
RUN cp -r src/services/brain/intent/signals dist/services/brain/intent/signals

EXPOSE 3005

CMD ["pnpm", "run", "start"]
