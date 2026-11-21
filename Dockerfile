# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @kubatur/web build && pnpm --filter @kubatur/server build \
 && pnpm --filter @kubatur/server deploy --prod --legacy /out

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/app/public DATA_DIR=/data
COPY --from=build /out ./
COPY --from=build /app/apps/web/dist ./public
VOLUME ["/data"]
EXPOSE 8080
USER node
CMD ["node", "dist/main.js"]
