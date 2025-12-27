FROM node:20-alpine AS build

WORKDIR /app
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
COPY apps/operator-api/package.json apps/operator-api/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages packages
COPY apps/operator-api apps/operator-api

# Build Shared
RUN pnpm -r --filter ./packages/prisma-schema exec prisma generate

# Build App
WORKDIR /app/apps/operator-api
RUN pnpm run build

# Runtime Stage
FROM node:20-alpine

WORKDIR /app/apps/operator-api

# We could try to copy just dist and node_modules, but with pnpm and potential symlinks/hoisting, it's safer to copy the built structure or use a deployer.
# For simplicity/robustness in Phase 29.5: Copy built app.
# But dependencies are at root and workspace structure.
# Simplest: Use the build image or copy the whole structure?
# Copying whole structure is heavy.
# Better: Use "deploy" command of pnpm? Or just copy what's needed.
# Since we are in Monorepo, let's just stick to copying dist and node_modules is tricky because of symlinks to root.
# PROPOSAL: Use single stage for now or keep build environment if size isn't critical constraint (it's "Structure" phase). 
# But let's try to be clean.
# Actually, copying root node_modules and app node_modules works.
# Copy root
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/package.json /app/package.json
# Copy packages
COPY --from=build /app/packages /app/packages
# Copy app
COPY --from=build /app/apps/operator-api/dist ./dist
COPY --from=build /app/apps/operator-api/package.json ./

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "dist/index.js"]
