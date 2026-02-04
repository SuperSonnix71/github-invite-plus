FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server ./apps/server
RUN pnpm --filter @gip/server build

FROM base AS runner
ENV NODE_ENV=production
RUN apk add --no-cache dumb-init
USER node
WORKDIR /app
COPY --from=builder --chown=node:node /app/apps/server/dist ./apps/server/dist
COPY --from=builder --chown=node:node /app/apps/server/package.json ./apps/server/
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=deps --chown=node:node /app/apps/server/node_modules ./apps/server/node_modules

EXPOSE 8787

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/server/dist/index.js"]
