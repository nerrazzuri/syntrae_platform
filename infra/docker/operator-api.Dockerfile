# =========================
# Build Stage
# =========================
FROM node:20-alpine AS build

WORKDIR /app
RUN npm install -g pnpm

# Copy workspace config
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Copy package manifests (for cache)
COPY packages/domain-models/package.json packages/domain-models/
COPY packages/prisma-schema/package.json packages/prisma-schema/
COPY packages/shared-config/package.json packages/shared-config/
COPY packages/intent-taxonomy/package.json packages/intent-taxonomy/
COPY packages/llm-contracts/package.json packages/llm-contracts/
COPY apps/operator-api/package.json apps/operator-api/

# Install deps
RUN pnpm install --frozen-lockfile

# Copy full source
COPY packages packages
COPY apps/operator-api apps/operator-api

# Prisma generate
RUN pnpm -r --filter ./packages/prisma-schema exec prisma generate

# Build operator-api
WORKDIR /app/apps/operator-api
RUN pnpm run build

# 🚀 Create runtime bundle (THIS IS THE KEY)
WORKDIR /app
RUN pnpm deploy --filter ./apps/operator-api --prod --legacy /app/deploy


# =========================
# Runtime Stage
# =========================
FROM node:20-alpine

WORKDIR  /app/apps/operator-api

ENV NODE_ENV=production

# Copy runtime bundle (flattened deps + dist)
COPY --from=build /app/deploy ./

EXPOSE 3001

CMD ["node", "dist/index.js"]
