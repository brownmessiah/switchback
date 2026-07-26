/**
 * Seed-data purge — operational wrapper (launch-readiness 05).
 *
 * Two modes: --dry-run (read-only, prints the plan) and --execute
 * (applies it inside ONE transaction, behind an explicit --confirm
 * token that the dry-run prints, so nothing can be applied without
 * having first seen the counts).
 *
 * All logic lives in the tested modules under lib/launch/ — this file
 * only parses arguments, asserts the target, and renders.
 *
 *   DATABASE_URL=... pnpm tsx scripts/purge-seed-data.ts --dry-run
 *
 * The production database is private-IP-only, so DATABASE_URL will point
 * either through the Cloud SQL Auth Proxy or at the in-VPC address from
 * a Cloud Run Job.
 */

import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'

import { executePurgePlan } from '@/lib/launch/purge-execute'
import { buildPurgePlan, type PurgePlan } from '@/lib/launch/purge-plan'
import { assertPurgeTarget, describeTarget } from '@/lib/launch/purge-target'

function renderPlan(plan: PurgePlan, target: string, mode: 'dry-run' | 'execute'): string {
  const lines: string[] = []
  const rule = '─'.repeat(72)

  lines.push(rule)
  lines.push(mode === 'dry-run' ? 'SEED-DATA PURGE — DRY RUN (nothing will be deleted)' : 'SEED-DATA PURGE — EXECUTING')
  lines.push(`target: ${target}`)
  lines.push(rule)
  lines.push('')

  lines.push(`Seeded Users found:       ${plan.seedUserIds.length}`)
  lines.push(`Seeded Experiences found: ${plan.seedExperienceIds.length}`)
  lines.push('')

  const nonEmpty = plan.entries.filter((e) => e.rowCount > 0)
  if (nonEmpty.length === 0) {
    lines.push('No seed rows found — the database is already clean.')
  } else {
    lines.push('Rows that WOULD be deleted, in execution order:')
    lines.push('')
    const width = Math.max(...nonEmpty.map((e) => e.table.length))
    for (const entry of nonEmpty) {
      lines.push(
        `  ${entry.table.padEnd(width)}  ${String(entry.rowCount).padStart(7)}   ${entry.reason}`,
      )
    }
    lines.push('')
    lines.push(`  ${'TOTAL'.padEnd(width)}  ${String(plan.totalRows).padStart(7)}`)
  }

  lines.push('')
  lines.push('Explicitly preserved:')
  for (const exclusion of plan.exclusions) {
    lines.push(`  - ${exclusion.table}: ${exclusion.reason}`)
  }

  if (plan.blockers.length > 0) {
    lines.push('')
    lines.push(rule)
    lines.push('BLOCKED — real data references rows this purge would delete.')
    lines.push(rule)
    for (const blocker of plan.blockers) {
      lines.push('')
      lines.push(
        `  ${blocker.table}.${blocker.column} (ON DELETE ${blocker.onDelete}) — ${blocker.rowCount} row(s)`,
      )
      lines.push(`    ${blocker.consequence}`)
      lines.push(`    sample ids: ${blocker.sampleIds.join(', ')}`)
    }
    lines.push('')
    lines.push('Resolve these before purging. Execution is refused.')
  }

  lines.push('')
  lines.push(rule)
  lines.push(
    plan.safeToExecute
      ? 'RESULT: safe to execute.'
      : 'RESULT: NOT SAFE TO EXECUTE — see blockers above.',
  )
  lines.push(rule)

  return lines.join('\n')
}

/**
 * Confirmation token for `--execute`.
 *
 * Deliberately NOT an interactive stdin prompt: the production database
 * is private-IP-only, so this may have to run as a Cloud Run Job, which
 * has no stdin. A token passed on the command line works identically
 * whether the operator is at a terminal behind the Cloud SQL Auth Proxy
 * or launching a Job, and it is still impossible to trigger by accident.
 *
 * The operator gets the token from the dry-run output, so `--execute`
 * cannot be run without having first seen the counts.
 */
const CONFIRM_TOKEN = 'PURGE-PRODUCTION-SEED-DATA'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const execute = args.includes('--execute')

  if (dryRun === execute) {
    console.error('Pass exactly one of --dry-run or --execute.')
    process.exit(2)
  }

  const connectionUrl = process.env['DATABASE_URL']
  // Refuses anything but the exact production database name. `outvers` is
  // a prefix of `outvers_dev` and `outvers_e2e`, so this must be exact.
  assertPurgeTarget(connectionUrl)

  const sql = postgres(connectionUrl!, { max: 1 })
  try {
    const db = drizzle(sql)
    const plan = await buildPurgePlan(db as never)
    console.log(renderPlan(plan, describeTarget(connectionUrl!), dryRun ? 'dry-run' : 'execute'))

    if (dryRun) {
      if (plan.safeToExecute) {
        console.log('')
        console.log(`To apply, re-run with:  --execute --confirm ${CONFIRM_TOKEN}`)
      }
      process.exit(plan.safeToExecute ? 0 : 1)
    }

    if (!plan.safeToExecute) {
      console.error('\nRefusing to execute: the plan carries blockers (above).')
      process.exit(1)
    }

    const confirmIndex = args.indexOf('--confirm')
    if (confirmIndex === -1 || args[confirmIndex + 1] !== CONFIRM_TOKEN) {
      console.error(
        `\nRefusing to execute without confirmation. Re-run with: --execute --confirm ${CONFIRM_TOKEN}`,
      )
      process.exit(2)
    }

    console.log('\nExecuting inside a single transaction…')
    // One transaction: a failure part-way through must not leave
    // production half-purged.
    const result = await (db as never as {
      transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>
    }).transaction(async (tx) => executePurgePlan(tx as never, plan))

    console.log('')
    console.log('DELETED:')
    for (const [table, rows] of Object.entries(result.deleted)) {
      console.log(`  ${table.padEnd(32)} ${String(rows).padStart(7)}`)
    }
    console.log(`  ${'TOTAL'.padEnd(32)} ${String(result.totalDeleted).padStart(7)}`)
    console.log('')
    console.log(`Completed at ${result.executedAt.toISOString()}`)
    console.log('Record this summary in the operational log.')
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
