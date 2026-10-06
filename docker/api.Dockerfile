# Builds the API image (also used for the worker with a different command).
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
ENV NODE_ENV=production NPM_CONFIG_UPDATE_NOTIFIER=false
WORKDIR /app
COPY --from=build --chown=node:node /out .
USER node
EXPOSE 3000
# Applies pending migrations, seeds the first admin and default templates (idempotent), then starts the API.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/seed.js && node dist/main.js"]
