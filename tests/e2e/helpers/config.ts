/**
 * Shared E2E test configuration helpers.
 */

/**
 * Derives the E2E database URL from `DATABASE_URL` by replacing the
 * database name component with `switchback_e2e`.
 */
export function e2eDbUrl(): string {
  const base = process.env.DATABASE_URL
  if (!base) throw new Error('DATABASE_URL env var is required')
  return base.replace(/\/[^/?]+(\?|$)/, '/switchback_e2e$1')
}
