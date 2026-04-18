# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────
# Build stage: compile TypeScript → ESM dist/
# ─────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /build

# Install dependencies first (layer-cached unless package*.json changes)
# Note: build context is repo root (..), so paths are relative to repo root.
COPY package*.json ./
RUN npm ci

# Copy source and compile
# tsup.config.ts and tsconfig.json must be present — tsup uses them for
# externals config (prevents CJS packages from being bundled into ESM output)
# and ignoreDeprecations (silences the baseUrl deprecation in dts build).
COPY tsup.config.ts tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ─────────────────────────────────────────────
# Production stage: lean runtime image
# ─────────────────────────────────────────────
FROM node:20-alpine AS production

# Create non-root user (no login shell) with explicit UID 10001
# UID 10001 is a standard application user UID above the system range (0-10000)
# Using a specific UID ensures consistent permissions across all environments and rebuilds.
# This is critical for volume mounts to work correctly without permission issues.
RUN addgroup -S -g 10001 fqc && \
    adduser -S -u 10001 -G fqc -s /sbin/nologin fqc

WORKDIR /app

# Copy compiled output and package manifests from build stage
COPY --chown=fqc:fqc --from=build /build/dist ./dist
COPY --chown=fqc:fqc --from=build /build/package*.json ./

# Copy example config for Docker environments (will be customized via volume mount or environment)
COPY --chown=fqc:fqc flashquery.example.yml ./flashquery.yaml

# Install production dependencies only (bcrypt v6+ ships prebuilt musl binaries)
RUN npm ci --omit=dev

# Ensure all files in /app are owned by fqc (npm installs as root, so we need to fix ownership)
RUN chown -R fqc:fqc /app

# Drop to non-root user
USER fqc

# Run the compiled entrypoint directly (no npm wrapper)
ENTRYPOINT ["node", "dist/index.js"]
