/**
 * Seed-data purge — operational wrapper (launch-readiness 05).
 *
 * DRY-RUN ONLY. This script has no capability to delete anything, which
 * is what makes it safe to point at production immediately. Execution
 * arrives in slice 06 behind an explicit confirmation gate.
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

import { buildPurgePlan, type PurgePlan } from '@/lib/launch/purge-plan'
import { assertPurgeTarget, describeTarget } from '@/lib/launch/purge-target'

function renderPlan(plan: PurgePlan, target: string): string {
  const lines: string[] = []
  const rule = '─'.repeat(72)

  lines.push(rule)
  lines.push(`SEED-DATA PURGE — DRY RUN (nothing will be deleted)`)
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
      ? 'RESULT: safe to execute. Re-run under slice 06 to apply.'
      : 'RESULT: NOT SAFE TO EXECUTE — see blockers above.',
  )
  lines.push(rule)

  return lines.join('\n')
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (!args.includes('--dry-run')) {
    console.error(
      'This script only supports --dry-run. It has no delete capability by design.',
    )
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
    console.log(renderPlan(plan, describeTarget(connectionUrl!)))
    process.exit(plan.safeToExecute ? 0 : 1)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
