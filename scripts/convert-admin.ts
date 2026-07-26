/**
 * Admin account conversion — operational wrapper (launch-readiness 07).
 *
 * A DISTINCT, separately-runnable step from the purge: it rotates a
 * credential and touches exactly one User, whereas the purge deletes
 * tens of thousands of rows. Bundling them would mean one confirmation
 * covering two very different risks.
 *
 * Run this BEFORE building the purge plan. Conversion moves the Admin's
 * email out of the `@seed.outvers.dev` predicate, so a plan built
 * afterwards is accurate at execution time; a plan built before it would
 * describe a database state that no longer exists when it runs
 * (RECON §G1).
 *
 *   DATABASE_URL=... ADMIN_PASSWORD=... \
 *     pnpm tsx scripts/convert-admin.ts --to aishwarye@outvers.com
 *
 * The password is read from the environment and never echoed, never
 * written to disk, and never passed as an argv value (argv is visible in
 * `ps` output on a shared host).
 *
 * NOTE for slice 08: this imports `@/lib/auth` -> `@/lib/env`, which
 * throws at module load without BETTER_AUTH_SECRET and
 * NEXT_PUBLIC_APP_URL. terraform/compute-run.tf injects only
 * DATABASE_URL into the `outvers-migrate` Job, so running this there
 * needs those two added first.
 */

import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'

import { assertPurgeTarget, describeTarget } from '@/lib/launch/purge-target'

/**
 * better-auth's hasher is only reachable through `@/lib/auth`, which
 * imports `@/lib/env` and THROWS AT MODULE LOAD when these are absent.
 * Checked up front and imported dynamically below, so a missing variable
 * produces an actionable message instead of a bare stack trace — this
 * runs against production, possibly inside a Cloud Run Job whose env is
 * currently DATABASE_URL-only (terraform/compute-run.tf).
 */
const REQUIRED_ENV = ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'NEXT_PUBLIC_APP_URL'] as const

function assertRequiredEnv(): void {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key])
  if (missing.length > 0) {
    throw new Error(
      `Refusing to run: missing required environment variable(s): ${missing.join(', ')}. ` +
        'better-auth\'s password hasher is reached through @/lib/auth, which validates ' +
        'the full env at import time.',
    )
  }
}

const DEFAULT_FROM_EMAIL = 'admin@seed.outvers.dev'

function argValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag)
  if (index === -1) return undefined
  return args[index + 1]
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  const toEmail = argValue(args, '--to')
  if (!toEmail) {
    console.error(
      'Usage: DATABASE_URL=... ADMIN_PASSWORD=... tsx scripts/convert-admin.ts --to <email> [--from <email>] [--name "Display Name"]',
    )
    process.exit(2)
  }
  const fromEmail = argValue(args, '--from') ?? DEFAULT_FROM_EMAIL
  const name = argValue(args, '--name')

  // Never accept the password on argv — it would be visible in `ps`.
  const password = process.env['ADMIN_PASSWORD']
  if (!password) {
    console.error(
      'Refusing to run: set ADMIN_PASSWORD in the environment. It is never accepted as a command-line argument (argv is world-readable via ps).',
    )
    process.exit(2)
  }

  assertRequiredEnv()

  const connectionUrl = process.env['DATABASE_URL']
  assertPurgeTarget(connectionUrl)

  // Dynamic: importing this eagerly would throw at module load before
  // any of the checks above could produce a useful message.
  const { convertSeedAdminToRealAccount } = await import('@/lib/launch/admin-conversion')

  const sql = postgres(connectionUrl!, { max: 1 })
  try {
    const db = drizzle(sql)
    console.log(`Converting ${fromEmail} -> ${toEmail} on ${describeTarget(connectionUrl!)}`)

    const result = await convertSeedAdminToRealAccount(db as never, {
      fromEmail,
      toEmail,
      password,
      ...(name ? { name } : {}),
    })

    console.log('')
    console.log(`  user id                 ${result.userId} (unchanged)`)
    console.log(`  email                   ${result.email} (${result.emailAction})`)
    console.log(`  credential              ${result.credentialAction}`)
    if (result.duplicateCredentialsRemoved > 0) {
      console.log(`  duplicates removed      ${result.duplicateCredentialsRemoved}`)
    }
    console.log('')
    console.log('NEXT: sign in with the new credential and confirm /admin loads')
    console.log('BEFORE treating the old one as retired. Store the password in a')
    console.log('password manager now — it is not recoverable from anywhere else.')
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error: unknown) => {
  // Never echo the password, even on an unexpected failure.
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
