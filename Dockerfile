# Build stage
FROM node:22-slim AS builder

# node-gyp (used by better-sqlite3 and keccak native bindings) needs python3
# and a C++ toolchain. `node:22-slim` ships without these.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

WORKDIR /app

# Copy workspace config and all package.json files for install
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/tsconfig/ ./packages/tsconfig/
COPY packages/shared/package.json ./packages/shared/
COPY packages/memorypack/package.json ./packages/memorypack/
COPY packages/tokenization/package.json ./packages/tokenization/
COPY packages/pmp-sdk/package.json ./packages/pmp-sdk/
COPY packages/brain/package.json ./packages/brain/
COPY apps/server/package.json ./apps/server/
COPY apps/workers/package.json ./apps/workers/
COPY apps/chat/package.json ./apps/chat/
COPY apps/dashboard/package.json ./apps/dashboard/

RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/shared/ ./packages/shared/
COPY packages/memorypack/ ./packages/memorypack/
COPY packages/tokenization/ ./packages/tokenization/
COPY packages/pmp-sdk/ ./packages/pmp-sdk/
COPY packages/brain/ ./packages/brain/
COPY apps/server/ ./apps/server/
COPY apps/workers/ ./apps/workers/
COPY apps/chat/ ./apps/chat/
COPY apps/dashboard/ ./apps/dashboard/
COPY apps/web/ ./apps/web/

# Build backend (order matters: deps come before their consumers)
#   tokenization → brain (memory.ts imports memoryContentHash)
#   tokenization → pmp-sdk (verify.ts imports memoryContentHash)
#   tokenization + pmp-sdk → server (mmp routes + smoke test cli)
RUN pnpm --filter @clude/shared build
RUN pnpm --filter @clude/memorypack build
RUN pnpm --filter @clude/tokenization build
RUN pnpm --filter @clude/brain build
RUN pnpm --filter @clude/pmp-sdk build
RUN pnpm --filter @clude/workers build
RUN pnpm --filter @clude/server build

# Build frontends
ARG PRIVY_APP_ID
ENV VITE_PRIVY_APP_ID=$PRIVY_APP_ID

RUN pnpm --filter @clude/chat exec vite build
RUN pnpm --filter @clude/dashboard exec vite build

# Production stage
FROM node:22-slim

# Same native toolchain — the prod `pnpm install --prod` still triggers
# native builds (better-sqlite3, keccak) because prebuilds aren't available
# for every arch.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/tsconfig/ ./packages/tsconfig/
COPY packages/shared/package.json ./packages/shared/
COPY packages/memorypack/package.json ./packages/memorypack/
COPY packages/tokenization/package.json ./packages/tokenization/
COPY packages/pmp-sdk/package.json ./packages/pmp-sdk/
COPY packages/brain/package.json ./packages/brain/
COPY apps/server/package.json ./apps/server/
COPY apps/workers/package.json ./apps/workers/
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/packages/shared/dist/ ./packages/shared/dist/
COPY --from=builder /app/packages/memorypack/dist/ ./packages/memorypack/dist/
COPY --from=builder /app/packages/tokenization/dist/ ./packages/tokenization/dist/
COPY --from=builder /app/packages/pmp-sdk/dist/ ./packages/pmp-sdk/dist/
COPY --from=builder /app/packages/brain/dist/ ./packages/brain/dist/
COPY --from=builder /app/apps/server/dist/ ./apps/server/dist/
COPY --from=builder /app/apps/workers/dist/ ./apps/workers/dist/
COPY --from=builder /app/apps/web/public/ ./apps/web/public/
COPY --from=builder /app/apps/chat/dist/ ./apps/chat/dist/
COPY --from=builder /app/apps/dashboard/dist/ ./apps/dashboard/dist/

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "apps/server/dist/index.js"]
