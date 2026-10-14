# syntax=docker/dockerfile:1
# Build context = REPO ROOT: docker build -f apps/server/Dockerfile .
# Server listens on 4000 (config.PORT default — fixed, do not change).
# Liveness: GET /health (always 200 when the process is up; /healthz is
# reserved by Google's edge on *.run.app and never reaches the container).
# Readiness: GET /readyz (200 + DB check).
# Required runtime env (never baked into the image): DATABASE_URL, SESSION_SECRET
# (>=32 chars), REDIS_URL, CORS_ORIGIN, GCS_PROJECT_ID, GCS_BUCKET,
# MEDIA_URL_TTL_SECONDS. Optional: GCS_EMULATOR_URL (local fake-gcs only),
# FCM_* (push, disabled by default).

# ---- base: pinned Node major + OS libs (OpenSSL for Prisma/pg, CA certs for GCS/FCM HTTPS) ----
FROM node:22-alpine AS base
RUN apk add --no-cache openssl libc6-compat ca-certificates
WORKDIR /app

# ---- deps: install all workspaces from the lockfile ----
# All workspace manifests must exist for `npm ci` to resolve. Only server+shared
# sources are copied into the image later; web is intentionally left out.
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

# ---- build: generate the Prisma client + fail fast on type errors ----
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server/tsconfig.json apps/server/tsconfig.json
COPY apps/server/prisma.config.ts apps/server/prisma.config.ts
COPY apps/server/prisma apps/server/prisma
COPY apps/server/src apps/server/src
# NOTE: apps/server/serviceAccountKey.json (if present) and any .env files are
# deliberately NOT copied — mount credentials at runtime instead (see AGENTS.md §4).
# `prisma generate` needs DATABASE_URL resolvable but never connects, so a dummy value suffices.
RUN DATABASE_URL=postgresql://localhost:5432/chatup?schema=public npm run prisma:generate -w @chatup/server
RUN npm run typecheck -w @chatup/server

# ---- runner: minimal prod image, non-root, tsx runtime ----
# No `tsc` build step: the server tsconfig is `noEmit` and `@chatup/shared` is
# consumed as TS source, so prod runs the same `tsx src/main.ts` entrypoint as
# `npm start`. Full node_modules are therefore retained for the `tsx` + `prisma` CLIs.
FROM base AS runner
ENV NODE_ENV=production \
  PORT=4000
WORKDIR /app/apps/server
COPY --from=build --chown=node:node /app/node_modules /app/node_modules
COPY --from=build --chown=node:node /app/packages/shared /app/packages/shared
COPY --from=build --chown=node:node /app/apps/server/package.json /app/apps/server/prisma.config.ts ./
COPY --from=build --chown=node:node /app/apps/server/prisma ./prisma
COPY --from=build --chown=node:node /app/apps/server/src ./src
RUN chown node:node /app/apps/server
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then((r)=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
# Apply versioned migrations on boot (never `db push`), then exec for correct signal handling.
CMD ["sh", "-c", "npx prisma migrate deploy && exec npx tsx src/main.ts"]
