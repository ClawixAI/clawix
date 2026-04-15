# Clawix API Server — production build
# Build: docker build -t clawix-api:latest -f infra/docker/api/Dockerfile .

# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Build
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace config, lockfile, and all source
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/api ./packages/api

# Install all dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# Build shared package first, then API
RUN pnpm --filter @clawix/shared build && \
    pnpm --filter @clawix/api build

# Generate Prisma client
RUN pnpm --filter @clawix/api exec prisma generate

# Deploy API with production dependencies only (creates standalone bundle)
# --legacy required for pnpm v10+ with workspace dependencies
RUN pnpm --filter @clawix/api deploy --prod --legacy /app/deploy

# Copy shared dist to deploy (workspace deps go into node_modules)
RUN cp -r /app/packages/shared/dist /app/deploy/node_modules/@clawix/shared/dist

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Production image
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS runner

# Install Docker CLI for agent container management and openssl for Prisma
RUN apt-get update && apt-get install -y --no-install-recommends \
    docker.io openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production

# Copy deployed bundle (includes node_modules with prod deps only)
COPY --from=builder /app/deploy ./

# Copy Prisma schema and migrations (needed for migrate deploy)
COPY --from=builder /app/packages/api/prisma ./prisma

# Copy pre-generated Prisma client from builder (at output path defined in schema)
COPY --from=builder /app/packages/api/src/generated/prisma ./src/generated/prisma

# Copy production prisma.config.ts (doesn't need dotenv - reads from env vars)
COPY infra/docker/api/prisma.config.ts ./prisma.config.ts

# Install prisma CLI for migrations only (client already generated)
RUN npm install -g prisma

# Create directories
RUN mkdir -p /data /app/skills

# Copy entrypoint script
COPY infra/docker/api/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Note: We run as root to access Docker socket, but the app itself
# is designed with security in mind. In K8s, use a service account instead.

EXPOSE 3001

# Health check (with longer start period for migrations)
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "fetch('http://localhost:3001/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

ENTRYPOINT ["/app/entrypoint.sh"]
