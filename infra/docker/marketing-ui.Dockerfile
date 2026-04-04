# syntax=docker/dockerfile:1
FROM node:20-alpine AS build

WORKDIR /repo

COPY apps/marketing-ui/package.json apps/marketing-ui/
COPY apps/marketing-ui apps/marketing-ui

WORKDIR /repo/apps/marketing-ui
RUN node scripts/build.mjs

FROM nginx:alpine

RUN rm /etc/nginx/conf.d/default.conf

COPY --from=build /repo/apps/marketing-ui/dist /usr/share/nginx/html
COPY apps/marketing-ui/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
