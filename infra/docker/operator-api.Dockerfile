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

# =========================
# Runtime Stage
# =========================
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache openssl

ENV NODE_ENV=production

# Copy root node_modules (where dependencies are installed in workspace)
COPY --from=build /app/node_modules /app/node_modules
# Copy app-specific node_modules (if any)
COPY --from=build /app/apps/operator-api/node_modules /app/apps/operator-api/node_modules
# Copy packages (symlinked deps might point here)
COPY --from=build /app/packages /app/packages
# Copy built app
COPY --from=build /app/apps/operator-api/dist /app/apps/operator-api/dist
COPY --from=build /app/apps/operator-api/package.json /app/apps/operator-api/package.json

WORKDIR /app/apps/operator-api

EXPOSE 3001

CMD ["node", "dist/index.js"]
