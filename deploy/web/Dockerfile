# syntax=docker/dockerfile:1
#
# Production image for the Jamulus web client: the Fastify WebSocket bridge plus
# the built Angular app.
#
# Build context is the repository root, so:
#   docker build -f deploy/web/Dockerfile -t jamulus-web .
#
# Two stages: the Angular toolchain is large and is not needed at runtime, so it
# stays in the build stage and the runtime installs production dependencies only.

FROM node:24-bookworm-slim AS build
WORKDIR /app

# Manifests first, so `npm ci` is cached across application-code changes.
COPY package.json package-lock.json ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
RUN npm ci

COPY . .
# Root build fans out over workspaces: web builds, server has no build step
# (Node 24 strips types at runtime).
RUN npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/server/package.json apps/server/package.json
RUN npm ci --omit=dev && npm cache clean --force

# The server resolves the repo root from its own location and serves the Angular
# build from apps/web/dist/web/browser, so the layout below has to be preserved.
COPY apps/server/src ./apps/server/src
COPY --from=build /app/apps/web/dist ./apps/web/dist

# Nothing is written at runtime, so drop privileges.
USER node

EXPOSE 8080

# SERVER_ADDRESS and HTTP_PORT come from the environment (see compose.yaml).
# No .env is baked in; process.env wins over the file anyway.
CMD ["node", "apps/server/src/index.ts"]
