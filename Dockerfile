FROM node:24-bookworm-slim AS base

ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV LIBREOFFICE_PATH=soffice
ENV PYTHON_PATH=python3

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libreoffice \
    libreoffice-calc \
    python3-uno \
    fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

USER node

EXPOSE 3000

CMD ["node", "server.js"]
