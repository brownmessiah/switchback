/**
 * Fresh database setup for E2E tests.
 *
 * Drops and recreates the `outvers_e2e` database, runs Drizzle `db:push`
 * to apply the schema, seeds with demo data, and (optionally) waits for
 * Meilisearch health before returning.
 *
 * Requires the `DATABASE_URL` env var to be set (pointing at any database
 * on the same server — typically the dev database). The function connects
 * to the `postgres` maintenance database to manage the E2E database.
 */

import { execSync } from 'node:child_process'

import postgres from 'postgres'

import { e2eDbUrl } from './config'

/**
 * Derives a connection URL pointing at the `postgres` maintenance
 * database (used for CREATE/DROP operations).
 */
function maintenanceDbUrl(): string {
  const base = process.env.DATABASE_URL
  if (!base) throw new Error('DATABASE_URL env var is required')
  return base.replace(/\/[^/?]+(\?|$)/, '/postgres$1')
}

const E2E_DB_NAME = 'outvers_e2e'

/**
 * Drops and recreates the E2E database, applies the Drizzle schema,
 * seeds it, and waits for Meilisearch health.
 */
export async function resetDatabase(): Promise<void> {
  // 1. Connect to postgres maintenance database to manage the E2E DB
  const maintenance = postgres(maintenanceDbUrl(), { max: 1 })
  try {
    // Guard: E2E_DB_NAME is a hardcoded const today, but assert its shape
    // to prevent SQL injection if it ever becomes configurable.
    if (!/^[a-z0-9_]+$/.test(E2E_DB_NAME)) {
      throw new Error(`Invalid E2E database name: ${E2E_DB_NAME}`)
    }

    // Terminate existing connections to the E2E DB
    await maintenance`
      SELECT pg_terminate_backend(pg_stat_activity.pid)
      FROM pg_stat_activity
      WHERE pg_stat_activity.datname = ${E2E_DB_NAME}
        AND pid <> pg_backend_pid()
    `

    // Drop and recreate — uses string interpolation with a validated const
    await maintenance.unsafe(`DROP DATABASE IF EXISTS ${E2E_DB_NAME}`)
    await maintenance.unsafe(`CREATE DATABASE ${E2E_DB_NAME}`)
  } finally {
    await maintenance.end()
  }

  // 2. Run drizzle-kit push against the E2E database
  const dbUrl = e2eDbUrl()
  execSync('npx drizzle-kit push --force', {
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: 'pipe',
    timeout: 30_000,
  })

  // 3. Run the seed script directly (bypass `pnpm db:seed` which wraps
  //    with `dotenv -e .env.local`, overriding our DATABASE_URL).
  execSync('npx tsx db/seed.ts', {
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: 'pipe',
    timeout: 30_000,
  })

  // 4. Wait for Meilisearch health (if configured)
  await waitForMeilisearch()
}

/**
 * Polls Meilisearch /health endpoint until it responds or times out.
 * Silently succeeds if MEILISEARCH_HOST is not configured (allows
 * running E2E tests without Meilisearch).
 */
async function waitForMeilisearch(timeoutMs = 10_000): Promise<void> {
  const host = process.env.MEILISEARCH_HOST
  if (!host) return

  const healthUrl = `${host.replace(/\/$/, '')}/health`
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) })
      if (res.ok) return
    } catch {
      // Not ready yet — retry
    }
    await new Promise((r) => setTimeout(r, 500))
  }

  console.warn(`Meilisearch at ${host} did not become healthy within ${timeoutMs}ms — continuing anyway`)
}
