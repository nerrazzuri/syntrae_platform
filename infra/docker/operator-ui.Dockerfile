# syntax=docker/dockerfile:1
# ---- Build stage ------------------------------------------
FROM node:20-alpine AS build

WORKDIR /repo

# Enable pnpm
RUN npm install -g pnpm

# 1. Manifests (Monorepo Root context)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
# Copy UI specific manifest
COPY apps/operator-ui/package.json apps/operator-ui/

# 2. Install Deps (Cached)
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# 3. Source (Scoped Copy - FIX FOR INVALIDATION)
COPY apps/operator-ui apps/operator-ui
# (Ideally copy shared packages if needed, keeping it simple/safe for now)

# 4. Build
WORKDIR /repo/apps/operator-ui
RUN pnpm run build

# ---- Runtime stage ----------------------------------------
FROM nginx:alpine

# Remove default config
RUN rm /etc/nginx/conf.d/default.conf

# Copy build output
COPY --from=build /repo/apps/operator-ui/dist /usr/share/nginx/html

# Copy custom Nginx config
COPY apps/operator-ui/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
