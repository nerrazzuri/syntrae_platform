# syntax=docker/dockerfile:1
FROM node:20-alpine AS build

WORKDIR /repo

# Enable pnpm
RUN npm install -g pnpm@10.33.4

# Monorepo manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/marketing-ui/package.json apps/marketing-ui/

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY apps/marketing-ui apps/marketing-ui

WORKDIR /repo/apps/marketing-ui
RUN pnpm run build

FROM nginx:alpine

RUN rm /etc/nginx/conf.d/default.conf

COPY --from=build /repo/apps/marketing-ui/dist /usr/share/nginx/html
COPY apps/marketing-ui/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
