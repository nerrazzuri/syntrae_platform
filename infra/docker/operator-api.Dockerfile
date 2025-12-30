# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS base
WORKDIR /repo
RUN corepack enable

# 1) Copy manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/operator-api/package.json apps/operator-api/package.json
COPY packages/prisma-schema/package.json packages/prisma-schema/package.json
COPY packages/intent-taxonomy/package.json packages/intent-taxonomy/package.json
COPY packages/llm-contracts/package.json packages/llm-contracts/package.json

# Install dependencies with cache
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# 2) Copy all source
COPY apps/operator-api apps/operator-api
COPY packages/prisma-schema packages/prisma-schema
COPY packages/intent-taxonomy packages/intent-taxonomy
COPY packages/llm-contracts packages/llm-contracts

# 3) Generate & Build
RUN pnpm --filter @syntrae/prisma-schema run generate
RUN pnpm --filter operator-api run build

# 4) Runtime (Fat Image)
# Copy everything from base to ensure symlinks work perfect
FROM node:20-bookworm-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production

RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update -y && apt-get install -y openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=base /repo ./

EXPOSE 3001
CMD ["node", "apps/operator-api/dist/index.js"]
