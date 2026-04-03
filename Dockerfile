# ── Stage 1: Build ────────────────────────────────────────────
FROM node:22-slim AS build

RUN corepack enable && corepack prepare pnpm@10.17.1 --activate

WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY tsconfig.json tsconfig.eslint.json ./
COPY src/ ./src/
COPY providers/ ./providers/
COPY channels/ ./channels/
COPY data/default/ ./data/default/
COPY apps/web/ ./apps/web/

# Build backend (TypeScript → dist/)
RUN pnpm build

# Build web UI (React → apps/web/dist/)
RUN pnpm build:web

# Prune dev dependencies
RUN CI=true pnpm prune --prod --ignore-scripts

# ── Stage 2: Runtime ──────────────────────────────────────────
FROM node:22-slim AS runtime

# System deps for Playwright (optional, for scraper features)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built app from build stage
COPY --from=build /app/dist/ ./dist/
COPY --from=build /app/node_modules/ ./node_modules/
COPY --from=build /app/package.json ./
COPY --from=build /app/package.json ./dist/
COPY --from=build /app/data/default/ ./data/default/
COPY --from=build /app/apps/web/dist/ ./apps/web/dist/
COPY --from=build /app/providers/ ./providers/
COPY --from=build /app/channels/ ./channels/
COPY yojin.mjs ./

# Create data directories
RUN mkdir -p /home/node/.yojin /home/node/.yojin-vault \
    && chown -R node:node /home/node/.yojin /home/node/.yojin-vault /app

USER node

# Backend API
EXPOSE 3000
# Web UI (served by nginx in compose, or via preview)
EXPOSE 4173

ENV NODE_ENV=production
ENV YOJIN_HOST=0.0.0.0
ENV YOJIN_HOME=/home/node/.yojin
ENV YOJIN_VAULT_DIR=/home/node/.yojin-vault

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "--disable-warning=DEP0040", "dist/src/entry.js"]
