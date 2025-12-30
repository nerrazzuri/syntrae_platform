FROM node:20-slim

WORKDIR /app

# Required system deps for Prisma
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# pnpm
RUN npm install -g pnpm

# Workspace config
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Prisma schema package
COPY packages/prisma-schema packages/prisma-schema

# Install deps with cache
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --filter @syntrae/prisma-schema...

WORKDIR /app/packages/prisma-schema

ENV NODE_ENV=production

CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]
