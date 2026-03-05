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
COPY src/verify-app/public/ ./dist/verify-app/public/

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/index.js"]
