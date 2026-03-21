# Build stage
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
COPY scripts/ ./scripts/
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# Production stage
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json* ./
COPY scripts/ ./scripts/
RUN npm ci

COPY --from=builder /app/dist/ ./dist/

# Copy static assets LAST — overwrites any stale files from builder
# Timestamp forces cache invalidation: 2026-03-21T14:50
ARG CACHEBUST=1
COPY src/verify-app/public/ ./dist/verify-app/public/

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/index.js"]
