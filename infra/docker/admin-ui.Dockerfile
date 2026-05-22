# syntax=docker/dockerfile:1
FROM node:20-alpine AS build

WORKDIR /repo
RUN npm install -g pnpm@10.33.4

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/admin-ui/package.json apps/admin-ui/

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

ARG VITE_ADMIN_API_BASE_URL
ENV VITE_ADMIN_API_BASE_URL=$VITE_ADMIN_API_BASE_URL

COPY apps/admin-ui apps/admin-ui

WORKDIR /repo/apps/admin-ui
RUN pnpm run build

FROM nginx:alpine
RUN rm /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/admin-ui/dist /usr/share/nginx/html
COPY apps/admin-ui/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
