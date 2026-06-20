import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  loadMigrationFiles,
  runMigrations,
  splitStatements,
  type MigrationClient,
  type MigrationFile,
} from './runner'

/**
 * Migration runner contract (ADR-0019). The runner is money-DB-adjacent: the
 * first real run of every migration is against prod Cloud SQL, so the ordering,
 * idempotency, per-file transactionality, and stop-on-failure behavior are all
 * pinned against a real (PGlite) Postgres here.
 *
 * The PGlite-backed MigrationClient below is exactly the single-connection shape
 * the prod postgres.js client (a reserved connection) satisfies — BEGIN/COMMIT
 * issued as statements form a real transaction on one connection.
 */
function pgliteClient(pg: PGlite): MigrationClient {
  return {
    exec: async (sql) => {
      await pg.exec(sql)
    },
    query: async <T = Record<string, unknown>>(sql: string) =>
      (await pg.query<T>(sql)).rows,
  }
}

const file = (filename: string, sql: string): MigrationFile => ({ filename, sql })

describe('splitStatements', () => {
  it('splits on the statement-breakpoint marker and drops empties', () => {
    expect(
      splitStatements('CREATE TABLE a (id int);\n--> statement-breakpoint\nCREATE TABLE b (id int);'),
    ).toEqual(['CREATE TABLE a (id int);', 'CREATE TABLE b (id int);'])
  })

  it('returns a single statement when there is no breakpoint', () => {
    expect(splitStatements('SELECT 1;')).toEqual(['SELECT 1;'])
  })
})

describe('runMigrations (PGlite)', () => {
  let pg: PGlite
  let client: MigrationClient

  beforeEach(() => {
    pg = new PGlite({ extensions: { pg_trgm } })
    client = pgliteClient(pg)
  })

  afterEach(async () => {
    await pg.close()
  })

  it('creates schema_migrations and applies pending files in lexical order, recording each', async () => {
    // Passed out of order to prove the runner sorts.
    const files = [
      file('0002_b.sql', 'CREATE TABLE t2 (id int);'),
      file('0001_a.sql', 'CREATE TABLE t1 (id int);'),
    ]
    const result = await runMigrations(client, files)

    expect(result.applied).toEqual(['0001_a.sql', '0002_b.sql'])
    expect(result.skipped).toEqual([])
    const rows = await client.query<{ filename: string }>(
      'SELECT filename FROM schema_migrations ORDER BY filename',
    )
    expect(rows.map((r) => r.filename)).toEqual(['0001_a.sql', '0002_b.sql'])
  })

  it('skips already-applied files (recorded by filename) — does not re-run their SQL', async () => {
    await client.exec('CREATE TABLE marker (n int)')
    // Pre-record 0001 as applied WITHOUT running its body.
    await runMigrations(client, []) // creates schema_migrations
    await client.exec("INSERT INTO schema_migrations (filename) VALUES ('0001_seed.sql')")

    const result = await runMigrations(client, [
      file('0001_seed.sql', "INSERT INTO marker (n) VALUES (1);"),
      file('0002_new.sql', "INSERT INTO marker (n) VALUES (2);"),
    ])

    expect(result.applied).toEqual(['0002_new.sql'])
    expect(result.skipped).toEqual(['0001_seed.sql'])
    const rows = await client.query<{ n: number }>('SELECT n FROM marker ORDER BY n')
    // 0001 was skipped (no row 1); only 0002 ran (row 2).
    expect(rows.map((r) => Number(r.n))).toEqual([2])
  })

  it('is idempotent — a second run with no new files is a no-op', async () => {
    const files = [file('0001_a.sql', 'CREATE TABLE t1 (id int);')]
    await runMigrations(client, files)
    const second = await runMigrations(client, files)
    expect(second.applied).toEqual([])
    expect(second.skipped).toEqual(['0001_a.sql'])
  })

  it('runs each file in its own transaction — a failing file rolls back its partial statements', async () => {
    const bad = file(
      '0001_bad.sql',
      'CREATE TABLE rollback_me (id int);\n--> statement-breakpoint\nTHIS IS NOT VALID SQL;',
    )
    await expect(runMigrations(client, [bad])).rejects.toThrow(/0001_bad\.sql/)

    // The first statement must have rolled back (transactional per file).
    const tables = await client.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'rollback_me') AS exists",
    )
    expect(tables[0]!.exists).toBe(false)
    // The failed file must NOT be recorded.
    const rows = await client.query<{ filename: string }>('SELECT filename FROM schema_migrations')
    expect(rows.map((r) => r.filename)).not.toContain('0001_bad.sql')
  })

  it('stops on the first failure — later files are not applied', async () => {
    const files = [
      file('0001_bad.sql', 'NOT VALID SQL;'),
      file('0002_good.sql', 'CREATE TABLE later (id int);'),
    ]
    await expect(runMigrations(client, files)).rejects.toThrow(/0001_bad\.sql/)
    const rows = await client.query<{ filename: string }>('SELECT filename FROM schema_migrations')
    expect(rows.map((r) => r.filename)).not.toContain('0002_good.sql')
  })

  it('applies the REAL db/migrations against a fresh database, then is a no-op on re-run', async () => {
    const dir = resolve(process.cwd(), 'db/migrations')
    const sqlCount = readdirSync(dir).filter((f) => f.endsWith('.sql')).length

    const first = await runMigrations(client, loadMigrationFiles(dir))
    expect(first.applied).toHaveLength(sqlCount)

    const count = await client.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM schema_migrations',
    )
    expect(Number(count[0]!.n)).toBe(sqlCount)

    // A core table and the 0034 FTS index both exist → all real migrations ran.
    const expTable = await client.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'experiences') AS exists",
    )
    expect(expTable[0]!.exists).toBe(true)
    const ftsIdx = await client.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'experiences_fts_idx') AS exists",
    )
    expect(ftsIdx[0]!.exists).toBe(true)

    const second = await runMigrations(client, loadMigrationFiles(dir))
    expect(second.applied).toEqual([])
    expect(second.skipped).toHaveLength(sqlCount)
  })
})
