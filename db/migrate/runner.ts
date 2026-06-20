import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Tracked migration runner (ADR-0019).
 *
 * The 34+ hand-authored `db/migrations/*.sql` are the source of truth — Drizzle's
 * journal is stale, so `drizzle-kit migrate` is unusable and `drizzle-kit push`
 * is destructive; NEITHER runs against prod. This runner maintains a
 * `schema_migrations(filename, applied_at)` ledger, applies each not-yet-recorded
 * file in lexical order inside its OWN transaction, records it, and stops loudly
 * on the first failure (so a half-applied schema never lands).
 *
 * It depends only on a tiny single-connection `MigrationClient` so the exact same
 * logic runs against PGlite in tests and a reserved postgres.js connection in
 * prod (Cloud Run Job). No drizzle, no path aliases, no env import here — this
 * module is bundled standalone for the distroless migrate entrypoint.
 */

export interface MigrationClient {
  /** Execute a SQL string (may contain multiple statements). No params. */
  exec(sql: string): Promise<void>
  /** Run a query and return its rows. */
  query<T = Record<string, unknown>>(sql: string): Promise<T[]>
}

export interface MigrationFile {
  filename: string
  sql: string
}

export interface MigrationResult {
  applied: string[]
  skipped: string[]
}

const SCHEMA_MIGRATIONS_DDL =
  'CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())'

/**
 * Split a migration file into individual statements on the drizzle
 * `--> statement-breakpoint` marker (a SQL line comment, so harmless if left in).
 * Mirrors the test harness so behavior is identical in test and prod.
 */
export function splitStatements(sql: string): string[] {
  return sql
    .split(/-->\s*statement-breakpoint/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Read every `*.sql` in `dir`, sorted lexically, into `{ filename, sql }`. */
export function loadMigrationFiles(dir: string): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((filename) => ({
      filename,
      sql: readFileSync(resolve(dir, filename), 'utf-8'),
    }))
}

function escapeLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export async function runMigrations(
  client: MigrationClient,
  files: MigrationFile[],
): Promise<MigrationResult> {
  await client.exec(SCHEMA_MIGRATIONS_DDL)

  const appliedRows = await client.query<{ filename: string }>(
    'SELECT filename FROM schema_migrations',
  )
  const already = new Set(appliedRows.map((r) => r.filename))

  // Defensive lexical sort so application order never depends on the caller.
  const sorted = [...files].sort((a, b) =>
    a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0,
  )

  const result: MigrationResult = { applied: [], skipped: [] }

  for (const { filename, sql } of sorted) {
    if (already.has(filename)) {
      result.skipped.push(filename)
      continue
    }

    const statements = splitStatements(sql)
    try {
      await client.exec('BEGIN')
      for (const stmt of statements) {
        await client.exec(stmt)
      }
      await client.exec(
        `INSERT INTO schema_migrations (filename) VALUES (${escapeLiteral(filename)})`,
      )
      await client.exec('COMMIT')
    } catch (err) {
      try {
        await client.exec('ROLLBACK')
      } catch {
        // ignore rollback failure — the original error is what matters
      }
      const detail = err instanceof Error ? err.message : String(err)
      throw new Error(`Migration failed: ${filename}\n${detail}`, { cause: err })
    }

    result.applied.push(filename)
  }

  return result
}
