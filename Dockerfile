# Build stage
FROM node:22-slim AS builder

RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

WORKDIR /app

# Copy workspace config and all package.json files for install
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/tsconfig/ ./packages/tsconfig/
COPY apps/server/package.json ./apps/server/
COPY apps/chat/package.json ./apps/chat/
COPY apps/dashboard/package.json ./apps/dashboard/

RUN pnpm install --frozen-lockfile

# Copy source
COPY apps/server/ ./apps/server/
COPY apps/chat/ ./apps/chat/
COPY apps/dashboard/ ./apps/dashboard/
COPY apps/web/ ./apps/web/

# Build backend
RUN pnpm --filter @clude/server build

# Build frontends
ARG PRIVY_APP_ID
ENV VITE_PRIVY_APP_ID=$PRIVY_APP_ID

RUN pnpm --filter @clude/chat exec vite build
RUN pnpm --filter @clude/dashboard exec vite build

# Production stage
FROM node:22-slim

RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

WORKDIR /app

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/tsconfig/ ./packages/tsconfig/
COPY apps/server/package.json ./apps/server/
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/apps/server/dist/ ./apps/server/dist/
COPY --from=builder /app/apps/web/public/ ./apps/web/public/

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "apps/server/dist/index.js"]
