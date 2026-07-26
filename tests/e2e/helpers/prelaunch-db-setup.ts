/**
 * Fresh database setup for the PRE-LAUNCH E2E project (launch-readiness 04).
 *
 * Provisions a SECOND, fully isolated E2E database (`outvers_e2e_prelaunch`):
 * schema pushed the same way `resetDatabase()` provisions `outvers_e2e`, but
 * seeded with ONLY the editorial blog corpus — zero Experiences, so
 * `getMarketplaceState()` resolves to 'pre-launch' for every request served
 * against it.
 *
 * This MUST stay a separate database rather than a truncate against
 * `outvers_e2e`: `playwright.config.ts` runs `fullyParallel` and every other
 * project shares `outvers_e2e` expecting the full seed (state='live') —
 * truncating `experiences` there mid-run would race them.
 *
 * Deliberately does NOT run `db/seed.ts` (that reintroduces Experiences) and
 * does NOT modify `db/seed.ts` or `db/content/blog/*` — only the standalone,
 * idempotent, production-safe blog seeder
 * (`db/content/blog/seed-content.ts`, the script behind `pnpm db:seed:blog`)
 * runs here, invoked directly via `tsx` with `DATABASE_URL` overridden
 * (bypassing the `dotenv -e .env.local` wrapper `pnpm db:seed:blog` uses —
 * same reason `resetDatabase()` bypasses `pnpm db:seed`'s wrapper for
 * `db/seed.ts`: dotenv-cli does not override an already-set env var, but
 * `pnpm`'s own script layer still resolves `.env.local` first, and a plain
 * `execSync` gives us a guaranteed, explicit override).
 */

import { execSync } from 'node:child_process'

import postgres from 'postgres'

import { e2ePrelaunchDbUrl } from './config'
import { maintenanceDbUrl } from './db-setup'

const E2E_PRELAUNCH_DB_NAME = 'outvers_e2e_prelaunch'

/**
 * Drops and recreates the pre-launch E2E database, applies the Drizzle
 * schema, installs `pg_trgm`, and seeds ONLY the blog corpus.
 */
export async function resetPrelaunchDatabase(): Promise<void> {
  // 1. Connect to postgres maintenance database to manage the pre-launch DB
  const maintenance = postgres(maintenanceDbUrl(), { max: 1 })
  try {
    // Guard: E2E_PRELAUNCH_DB_NAME is a hardcoded const today, but assert its
    // shape to prevent SQL injection if it ever becomes configurable.
    if (!/^[a-z0-9_]+$/.test(E2E_PRELAUNCH_DB_NAME)) {
      throw new Error(`Invalid pre-launch E2E database name: ${E2E_PRELAUNCH_DB_NAME}`)
    }

    // Terminate existing connections to the pre-launch E2E DB
    await maintenance`
      SELECT pg_terminate_backend(pg_stat_activity.pid)
      FROM pg_stat_activity
      WHERE pg_stat_activity.datname = ${E2E_PRELAUNCH_DB_NAME}
        AND pid <> pg_backend_pid()
    `

    // Drop and recreate — uses string interpolation with a validated const
    await maintenance.unsafe(`DROP DATABASE IF EXISTS ${E2E_PRELAUNCH_DB_NAME}`)
    await maintenance.unsafe(`CREATE DATABASE ${E2E_PRELAUNCH_DB_NAME}`)
  } finally {
    await maintenance.end()
  }

  // 2. Run drizzle-kit push against the pre-launch E2E database
  const dbUrl = e2ePrelaunchDbUrl()
  execSync('npx drizzle-kit push --force', {
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: 'pipe',
    timeout: 30_000,
  })

  // 2b. drizzle-kit push does NOT install pg_trgm (it's a hand-authored .sql
  //     in the prod migration chain) — add it explicitly, same as
  //     `resetDatabase()` does for `outvers_e2e`.
  const ext = postgres(dbUrl, { max: 1 })
  try {
    await ext.unsafe('CREATE EXTENSION IF NOT EXISTS pg_trgm')
  } finally {
    await ext.end()
  }

  // 3. Blog posts ONLY — no Experiences, no demo catalog, no fixtures. This
  //    is what makes `getMarketplaceState()` resolve 'pre-launch'.
  execSync('npx tsx db/content/blog/seed-content.ts', {
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: 'pipe',
    timeout: 30_000,
  })
}
