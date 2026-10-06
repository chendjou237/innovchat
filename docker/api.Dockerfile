# Builds the API image (also used for the worker with a different command).
# The image also contains the built dashboard, served by the API when WEB_DIST_DIR is set.

FROM node:22-bookworm-slim AS web
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @innovcare/web...
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @innovcare/web build

FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @innovcare/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @innovcare/shared build \
 && cd apps/api && npx prisma generate && npx nest build \
 && cd /app && pnpm deploy --filter @innovcare/api --prod --legacy /out \
 && cp -r apps/api/dist apps/api/prisma /out/ \
 && cd /out && npx prisma generate && npx prisma --version >/dev/null

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production NPM_CONFIG_UPDATE_NOTIFIER=false WEB_DIST_DIR=/app/public
WORKDIR /app
COPY --from=build --chown=node:node /out .
COPY --from=web --chown=node:node /app/apps/web/dist ./public
USER node
EXPOSE 3000
# Applies pending migrations, seeds the first admin and default templates (idempotent), then starts the API.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/seed.js && node dist/main.js"]
