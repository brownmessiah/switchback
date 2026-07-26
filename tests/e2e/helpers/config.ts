/**
 * Shared E2E test configuration helpers.
 */

/**
 * Derives the E2E database URL from `DATABASE_URL` by replacing the
 * database name component with `outvers_e2e`.
 */
export function e2eDbUrl(): string {
  const base = process.env.DATABASE_URL
  if (!base) throw new Error('DATABASE_URL env var is required')
  return base.replace(/\/[^/?]+(\?|$)/, '/outvers_e2e$1')
}

/**
 * Derives the PRE-LAUNCH E2E database URL (launch-readiness 04) from
 * `DATABASE_URL` by replacing the database name component with
 * `outvers_e2e_prelaunch`. This is a SECOND, fully isolated database — see
 * `tests/e2e/helpers/prelaunch-db-setup.ts` for why it must not share
 * `outvers_e2e` with every other (fullyParallel, state='live') project.
 */
export function e2ePrelaunchDbUrl(): string {
  const base = process.env.DATABASE_URL
  if (!base) throw new Error('DATABASE_URL env var is required')
  return base.replace(/\/[^/?]+(\?|$)/, '/outvers_e2e_prelaunch$1')
}
