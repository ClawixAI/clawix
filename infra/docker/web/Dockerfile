# Clawix Web Dashboard — production build
# Build: docker build -t clawix-web:latest -f infra/docker/web/Dockerfile .

# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Install dependencies
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS deps

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy workspace config and lockfile
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./

# Copy package.json files for each workspace package
COPY packages/shared/package.json packages/shared/
COPY packages/web/package.json packages/web/

# Install all dependencies (including devDependencies for build)
RUN pnpm install --frozen-lockfile

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Build
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Build-time environment variables
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/web/node_modules ./packages/web/node_modules

# Copy source code
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/web ./packages/web

# Build shared package first, then web
RUN pnpm --filter @clawix/shared build && \
    pnpm --filter @clawix/web build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3: Production image
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN groupadd -r clawix && useradd -r -g clawix clawix

# Copy Next.js build output
COPY --from=builder /app/packages/web/.next/standalone ./
COPY --from=builder /app/packages/web/.next/static ./packages/web/.next/static
COPY --from=builder /app/packages/web/public ./packages/web/public

# Set ownership
RUN chown -R clawix:clawix /app

USER clawix

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://localhost:3000').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "packages/web/server.js"]
