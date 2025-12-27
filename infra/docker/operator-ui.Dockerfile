FROM node:20-alpine AS build

WORKDIR /app
RUN npm install -g pnpm

# Copy workspace config
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Copy app config (UI likely doesn't need all packages yet, but for consistency)
COPY apps/operator-ui/package.json apps/operator-ui/

# Install deps
RUN pnpm install --frozen-lockfile

# Copy source
COPY apps/operator-ui apps/operator-ui

# Build
WORKDIR /app/apps/operator-ui
RUN pnpm run build

# Runtime
FROM nginx:alpine

COPY --from=build /app/apps/operator-ui/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
