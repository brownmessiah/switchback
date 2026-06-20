import { resolve } from 'node:path'

import postgres from 'postgres'

import { loadMigrationFiles, runMigrations, type MigrationClient } from './runner'

/**
 * Cloud Run Job entrypoint for the tracked migration runner (ADR-0019).
 *
 * Invoked as an alternate entrypoint of the SAME container image, inside the VPC,
 * so it reaches the private Cloud SQL instance over `DATABASE_URL`. The deploy
 * pipeline runs this Job (after an on-demand backup) and only proceeds to
 * `gcloud run deploy` on success.
 *
 *   node db/migrate/run.js     # (bundled; see Dockerfile / migrate Job)
 *
 * No path aliases / env-module imports here — this file is bundled standalone for
 * the distroless runtime (no tsx, no shell). It reads `DATABASE_URL` directly and
 * resolves the migrations dir from `MIGRATIONS_DIR` (default `db/migrations`).
 */

type UnsafeConn = { unsafe: (sql: string) => Promise<unknown> }

function makeClient(conn: UnsafeConn): MigrationClient {
  return {
    exec: async (sql) => {
      await conn.unsafe(sql)
    },
    query: async <T = Record<string, unknown>>(sql: string) =>
      (await conn.unsafe(sql)) as unknown as T[],
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('[migrate] DATABASE_URL is required')
    process.exit(1)
  }

  const dir = process.env.MIGRATIONS_DIR ?? resolve(process.cwd(), 'db/migrations')

  // Single connection (max:1) + a reserved handle so the BEGIN/…/COMMIT issued by
  // the runner all run on ONE connection — a genuine per-file transaction.
  const sql = postgres(url, {
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
  })

  let reserved: Awaited<ReturnType<typeof sql.reserve>> | undefined
  try {
    const files = loadMigrationFiles(dir)
    console.log(`[migrate] ${files.length} migration file(s) found in ${dir}`)
    reserved = await sql.reserve()
    const result = await runMigrations(makeClient(reserved), files)
    console.log(
      `[migrate] applied ${result.applied.length}, skipped ${result.skipped.length}`,
    )
    if (result.applied.length > 0) {
      console.log(`[migrate] applied: ${result.applied.join(', ')}`)
    }
    reserved.release()
    await sql.end()
    console.log('[migrate] OK')
    process.exit(0)
  } catch (err) {
    console.error('[migrate] FAILED:', err instanceof Error ? err.message : err)
    try {
      reserved?.release()
    } catch {
      // ignore
    }
    await sql.end({ timeout: 5 }).catch(() => {})
    process.exit(1)
  }
}

void main()
