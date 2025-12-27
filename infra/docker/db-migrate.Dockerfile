FROM node:20-alpine

WORKDIR /app
RUN npm install -g pnpm && \
    apk add --no-cache openssl

# Copy workspace config
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Copy the prisma-schema package
COPY packages/prisma-schema packages/prisma-schema

# Install dependencies for the schema package (including prisma CLI)
# We use --prod=false (or default) to ensure devDependencies like 'prisma' are installed
RUN pnpm install --filter @syntrae/prisma-schema...

# Set workdir to the package so we can run simple commands
WORKDIR /app/packages/prisma-schema

# Production env for runtime (optional, but good practice)
ENV NODE_ENV=production

# Validate schema connectivity and run migration
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]
