import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite'

import * as schema from '@/db/schema'

export type TestDB = PgliteDatabase<typeof schema>

/**
 * Spin up an in-process Postgres-compatible database backed by PGlite,
 * apply every migration in db/migrations, and return a Drizzle handle
 * plus a teardown function.
 *
 * Use in beforeAll / afterAll so we pay the schema-load cost once per
 * test file, not per test.
 */
export async function setupTestDb(): Promise<{
  db: TestDB
  pglite: PGlite
  teardown: () => Promise<void>
}> {
  // Register the pg_trgm contrib extension so migration 0034's
  // `CREATE EXTENSION pg_trgm` + the trigram/FTS indexes apply under PGlite
  // (Postgres-native search, ADR-0019). Without this the migration replay fails
  // for the whole suite, not just the search tests.
  const pglite = new PGlite({ extensions: { pg_trgm } })
  const db = drizzle(pglite, { schema })

  const migrationsDir = resolve(process.cwd(), 'db/migrations')
  const migrationFiles = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of migrationFiles) {
    const sql = readFileSync(resolve(migrationsDir, file), 'utf-8')
    // drizzle-kit emits "--> statement-breakpoint" between DDL statements;
    // PGlite's exec runs each statement individually.
    const statements = sql
      .split(/-->\s*statement-breakpoint/)
      .map((s) => s.trim())
      .filter(Boolean)
    for (const stmt of statements) {
      await pglite.exec(stmt)
    }
  }

  return {
    db,
    pglite,
    teardown: async () => {
      await pglite.close()
    },
  }
}
