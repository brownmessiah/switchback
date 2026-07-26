/**
 * Purge execution (launch-readiness 06) — the destructive half.
 *
 * Consumes a plan built by `buildPurgePlan` rather than re-deriving what
 * to delete, so what the operator approved in the dry-run is exactly
 * what runs. Every deletion happens inside a single caller-supplied
 * transaction: a failure part-way through must not leave production
 * half-purged.
 *
 * Refuses outright when the plan carries referential blockers. That is
 * not belt-and-braces — `reviews.experience_id` and
 * `cart_items.experience_id` are CASCADE, so executing a blocked plan
 * would silently and irreversibly destroy real Customers' Reviews and
 * carts, with no row in the plan to show for it.
 *
 * Re-running against an already-purged database is a no-op: the plan
 * built against it is empty, and every statement matches zero rows.
 */

import { sql, type SQL } from 'drizzle-orm'

import type { DBOrTx } from '@/lib/payments/commission-resolver'

import type { PurgePlan } from './purge-plan'
import { NEVER_PURGE_TABLES } from './seed-data-registry'

export interface PurgeExecutionResult {
  /** Rows actually deleted, per table. Compare against the plan. */
  deleted: Record<string, number>
  totalDeleted: number
  executedAt: Date
}

/**
 * Apply `plan` inside `tx`. The caller owns the transaction, so the
 * operator's confirmation gate and the transaction boundary stay in the
 * script where they belong.
 */
export async function executePurgePlan(
  tx: DBOrTx,
  plan: PurgePlan,
): Promise<PurgeExecutionResult> {
  if (!plan.safeToExecute || plan.blockers.length > 0) {
    const summary = plan.blockers
      .map((b) => `${b.table}.${b.column} (${b.rowCount} row(s), ON DELETE ${b.onDelete})`)
      .join('; ')
    throw new Error(
      `Refusing to execute: the plan carries ${plan.blockers.length} referential ` +
        `blocker(s) — ${summary}. Real data references rows this purge would ` +
        'delete; resolve them and rebuild the plan.',
    )
  }

  const deleted: Record<string, number> = {}

  for (const entry of plan.entries) {
    if (entry.rowCount === 0) continue

    // Defence in depth: the order list already excludes these, but a
    // protected table reaching a DELETE would be unrecoverable (and
    // audit_logs would abort the whole transaction on its trigger).
    if ((NEVER_PURGE_TABLES as readonly string[]).includes(entry.table)) {
      throw new Error(
        `Refusing to execute: plan targets protected table "${entry.table}".`,
      )
    }

    const affected = await deleteEntry(tx, entry.table, plan)
    if (affected > 0) deleted[entry.table] = affected
  }

  return {
    deleted,
    totalDeleted: Object.values(deleted).reduce((sum, n) => sum + n, 0),
    executedAt: new Date(),
  }
}

/**
 * Delete a table's targeted rows using the SAME predicate the planner
 * counted with, expressed against the id sets the plan carries.
 */
async function deleteEntry(
  tx: DBOrTx,
  table: string,
  plan: PurgePlan,
): Promise<number> {
  const where = await buildDeleteWhere(tx, table, plan)
  if (!where) return 0

  // RETURNING + row count rather than the driver's affected-rows field:
  // postgres-js and PGlite report that differently, and the operational
  // record must not silently read zero for a delete that happened.
  const result = await tx.execute(
    sql`DELETE FROM ${sql.identifier(table)} WHERE ${where} RETURNING 1 AS deleted`,
  )
  return readRowCount(result)
}

async function buildDeleteWhere(
  _tx: DBOrTx,
  table: string,
  plan: PurgePlan,
): Promise<SQL | null> {
  const targets = plan.deleteTargets[table]
  if (!targets) return null

  if (targets.kind === 'ids') {
    if (targets.ids.length === 0) return null
    return sql`id = ANY(${sql.param(targets.ids)})`
  }

  if (targets.kind === 'column-in') {
    if (targets.values.length === 0) return null
    return sql`${sql.identifier(targets.column)} = ANY(${sql.param([...targets.values])})`
  }

  if (targets.kind === 'like') {
    return sql`${sql.identifier(targets.column)} LIKE ${targets.pattern}`
  }

  if (targets.kind === 'root-columns') {
    const parts = targets.clauses
      .filter((c) => c.ids.length > 0)
      .map((c) => sql`${sql.identifier(c.column)} = ANY(${sql.param(c.ids)})`)
    if (parts.length === 0) return null
    return sql.join(parts, sql` OR `)
  }

  return null
}

function readRowCount(result: unknown): number {
  const withRows = result as { rows?: unknown[] }
  if (Array.isArray(withRows?.rows)) return withRows.rows.length
  if (Array.isArray(result)) return result.length
  return 0
}
