# Build stage
FROM node:22-slim AS builder

WORKDIR /app

# Backend dependencies
COPY package.json package-lock.json* ./
COPY scripts/ ./scripts/
RUN npm ci

# Frontend dependencies
COPY chat/package.json chat/package-lock.json* ./chat/
RUN cd chat && npm ci --legacy-peer-deps

COPY dashboard/package.json dashboard/package-lock.json* ./dashboard/
RUN cd dashboard && npm ci --legacy-peer-deps

# Copy source
COPY tsconfig.json ./
COPY src/ ./src/
COPY chat/ ./chat/
COPY dashboard/ ./dashboard/

# Build backend
RUN npm run build

# Build frontends
ARG PRIVY_APP_ID
ENV VITE_PRIVY_APP_ID=$PRIVY_APP_ID

RUN cd chat && npx vite build
RUN cd dashboard && npx vite build

# Production stage
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json* ./
COPY scripts/ ./scripts/
RUN npm ci

COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/src/verify-app/public/ ./dist/verify-app/public/

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/index.js"]
