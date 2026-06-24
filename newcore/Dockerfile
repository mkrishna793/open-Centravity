# ═══════════════════════════════════════════════════════════════
# Velocity — Production Dockerfile
# 3-stage build: deps → builder → runner
# Final image: Alpine Node 20, non-root user, ~180MB
# ═══════════════════════════════════════════════════════════════

# ── Stage 1: deps ─────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app

# Native build tools required for z3-solver + @libsql/client
RUN apk add --no-cache python3 make g++ libc6-compat

COPY newcore/package*.json ./
RUN npm ci --ignore-scripts

# ── Stage 2: builder ──────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY --from=deps /app/node_modules ./node_modules
COPY newcore/ .

RUN npm run build

# ── Stage 3: runner ───────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Non-root user for production security
RUN addgroup -S velocity && adduser -S velocity -G velocity

# Copy only production artifacts
COPY --from=builder /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
COPY newcore/package.json ./

# Create volume directories and set permissions
RUN mkdir -p workspaces artifacts data && \
    chown -R velocity:velocity /app

USER velocity

EXPOSE 3777

CMD ["node", "dist/index.js"]
