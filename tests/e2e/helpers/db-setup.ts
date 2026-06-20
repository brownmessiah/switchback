/**
 * Fresh database setup for E2E tests.
 *
 * Drops and recreates the `outvers_e2e` database, runs Drizzle `db:push`
 * to apply the schema, and seeds with demo data. With Postgres-native search
 * the seeded DB IS the search source — there is no separate index to ready.
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
 * and seeds it.
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

  // 2b. Postgres-native search needs pg_trgm (`word_similarity` for the `q`
  //     query). The prod 0034 migration installs it; drizzle-kit push does NOT
  //     (it's a hand-authored .sql), so add it to the E2E DB explicitly.
  const ext = postgres(dbUrl, { max: 1 })
  try {
    await ext.unsafe('CREATE EXTENSION IF NOT EXISTS pg_trgm')
  } finally {
    await ext.end()
  }

  // 3. Run the seed script directly (bypass `pnpm db:seed` which wraps
  //    with `dotenv -e .env.local`, overriding our DATABASE_URL).
  execSync('npx tsx db/seed.ts', {
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: 'pipe',
    timeout: 30_000,
  })
}
