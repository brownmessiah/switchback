# syntax=docker/dockerfile:1
#
# outvers-next container (ADR-0019). One image, two run modes:
#   - default CMD ["server.js"]  → the public/cron Next standalone web server
#   - command ["migrate.cjs"]    → the tracked migration runner (Cloud Run Job)
#
# Multi-stage: full Node 22 build (pnpm + next build --standalone + esbuild bundle
# of the migrate entrypoint) → distroless nodejs22 runtime (glibc so sharp works;
# no shell — debug via logs), non-root.

# ---- Build stage -----------------------------------------------------------
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Pinned pnpm via corepack (packageManager field).
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

# Install deps first (cached unless the lockfile changes).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# App source.
COPY . .

# NEXT_PUBLIC_* are baked into the client bundle at build → real value as a build
# arg. The build prerenders ZERO data pages (registry-based generateStaticParams),
# so it never connects to the DB; but lib/env validates the presence/format of the
# required server vars at import, so pass schema-satisfying PLACEHOLDERS here.
# Runtime injects the real DATABASE_URL / BETTER_AUTH_SECRET via Secret Manager.
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL}
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# DB/secret placeholders are scoped to this RUN only (not baked as image ENV) —
# the build never connects (0 data pages prerender); runtime injects the real
# values via Secret Manager.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build \
    BETTER_AUTH_SECRET=build-time-placeholder-secret-not-used-at-runtime-0123456789 \
    pnpm build

# Bundle the migrate Job entrypoint into a self-contained CJS (the distroless
# runtime has no tsx/shell). Inlines postgres.js + the runner.
RUN pnpm exec esbuild db/migrate/run.ts \
      --bundle --platform=node --target=node22 --format=cjs \
      --outfile=migrate.cjs

# ---- Runtime stage (distroless) -------------------------------------------
FROM gcr.io/distroless/nodejs22-debian12 AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

# Next standalone layout + static assets + public. Owned by the distroless
# nonroot uid (65532) so the server can write the ISR cache under .next/cache.
COPY --from=builder --chown=65532:65532 /app/.next/standalone ./
COPY --from=builder --chown=65532:65532 /app/.next/static ./.next/static
COPY --from=builder --chown=65532:65532 /app/public ./public

# Migrate Job: the bundled runner + the .sql files it applies.
COPY --from=builder --chown=65532:65532 /app/migrate.cjs ./migrate.cjs
COPY --from=builder --chown=65532:65532 /app/db/migrations ./db/migrations

USER 65532:65532
EXPOSE 8080

# Web/cron service. The distroless entrypoint is `node`, so CMD is the script.
# The migrate Cloud Run Job overrides the command to ["migrate.cjs"].
CMD ["server.js"]
