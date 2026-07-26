import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { NEVER_PURGE_TABLES } from './seed-data-registry'
import { PURGE_TABLE_ORDER, purgeOrderIndex } from './purge-order'
import { setupTestDb, type TestDB } from '@/tests/helpers/db'

/**
 * Validates the hand-written purge order against the REAL foreign-key
 * graph in `information_schema` (launch-readiness 05).
 *
 * This is the test that earns the right to hand-write the order. Two FKs
 * exist only in the .sql migrations and are absent from the Drizzle
 * schema, so anything derived from TypeScript would be wrong in exactly
 * the way that breaks a production purge mid-transaction. Reading the
 * live catalog sees them.
 */

interface FkRow {
  child_table: string
  child_column: string
  parent_table: string
  delete_rule: string
}

describe('purge order vs the live foreign-key graph', () => {
  let db: TestDB
  let teardown: () => Promise<void>
  let fks: FkRow[]

  beforeAll(async () => {
    const setup = await setupTestDb()
    db = setup.db
    teardown = setup.teardown

    const result = await db.execute(sql`
      SELECT
        tc.table_name        AS child_table,
        kcu.column_name      AS child_column,
        ccu.table_name       AS parent_table,
        rc.delete_rule       AS delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.table_schema = tc.table_schema
      JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = tc.constraint_name
       AND rc.constraint_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'
    `)
    fks = (result as unknown as { rows?: FkRow[] }).rows ?? (result as unknown as FkRow[])
  })

  afterAll(async () => {
    await teardown()
  })

  it('reads a non-trivial FK graph from the database', () => {
    expect(fks.length).toBeGreaterThan(30)
  })

  // The load-bearing assertion: these two exist ONLY in the .sql
  // migrations. If a future refactor moves them into Drizzle, fine — but
  // if this test stops seeing them, the catalog query is broken and every
  // other assertion here is worthless.
  it('sees the two SQL-only foreign keys that Drizzle does not declare', () => {
    const payoutFk = fks.find(
      (f) => f.child_table === 'bookings' && f.child_column === 'payout_batch_id',
    )
    const tripGroupFk = fks.find(
      (f) => f.child_table === 'bookings' && f.child_column === 'trip_group_id',
    )
    expect(payoutFk?.parent_table).toBe('payouts')
    expect(tripGroupFk?.parent_table).toBe('trip_groups')
  })

  /**
   * The core invariant. For every RESTRICT/NO ACTION edge where BOTH
   * tables are purged, the child must be deleted before the parent —
   * otherwise the parent delete raises and aborts the transaction.
   */
  it('deletes every RESTRICT child before its parent', () => {
    const violations: string[] = []

    for (const fk of fks) {
      const rule = fk.delete_rule.toUpperCase()
      if (rule !== 'RESTRICT' && rule !== 'NO ACTION') continue
      if (fk.child_table === fk.parent_table) continue

      const childIdx = purgeOrderIndex(fk.child_table)
      const parentIdx = purgeOrderIndex(fk.parent_table)
      // Only edges where both ends are actually purged constrain us.
      if (childIdx === -1 || parentIdx === -1) continue

      if (childIdx > parentIdx) {
        violations.push(
          `${fk.child_table}.${fk.child_column} -> ${fk.parent_table} (${rule}): ` +
            `child at ${childIdx} must come before parent at ${parentIdx}`,
        )
      }
    }

    expect(violations).toEqual([])
  })

  it('never schedules a protected table for deletion', () => {
    for (const table of NEVER_PURGE_TABLES) {
      expect(PURGE_TABLE_ORDER).not.toContain(table)
    }
  })

  it('lists every table exactly once', () => {
    const seen = new Set(PURGE_TABLE_ORDER)
    expect(seen.size).toBe(PURGE_TABLE_ORDER.length)
  })

  it('only names tables that actually exist in the database', async () => {
    const result = await db.execute(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `)
    const rows =
      (result as unknown as { rows?: { table_name: string }[] }).rows ??
      (result as unknown as { table_name: string }[])
    const existing = new Set(rows.map((r) => r.table_name))

    const missing = PURGE_TABLE_ORDER.filter((t) => !existing.has(t))
    expect(missing).toEqual([])
  })

  /**
   * A table that holds seed rows but is absent from the order would be
   * silently skipped. Any table with an FK into `users` or `experiences`
   * must be either purged or explicitly protected.
   */
  it('accounts for every table reachable from users or experiences', () => {
    const protectedTables = new Set<string>(NEVER_PURGE_TABLES)
    const unaccounted = new Set<string>()

    for (const fk of fks) {
      if (fk.parent_table !== 'users' && fk.parent_table !== 'experiences') continue
      if (protectedTables.has(fk.child_table)) continue
      if (purgeOrderIndex(fk.child_table) === -1) unaccounted.add(fk.child_table)
    }

    expect([...unaccounted].sort()).toEqual([])
  })
})
