/**
 * Production-target assertion for the purge (launch-readiness 05).
 *
 * The purge is irreversible, so it must be incapable of running against
 * anything but production. The naive checks are all unsafe here:
 *
 *  - `url.includes('outvers')` / `startsWith('outvers')` — the production
 *    database is named `outvers`, which is a strict PREFIX of both
 *    `outvers_dev` and `outvers_e2e`. Every substring or prefix test
 *    passes for all three, so the "safety check" would happily destroy a
 *    developer's local data or the E2E database mid-suite.
 *  - `NODE_ENV` — useless in both directions. It defaults to
 *    'development' on a laptop connected to production through the Cloud
 *    SQL Auth Proxy, and the Dockerfile bakes 'production' into the
 *    container regardless of which database that container is pointed at.
 *
 * What is left is exact database-name equality, parsed from the URL.
 */

/** The production database name (terraform/database.tf). */
export const PRODUCTION_DB_NAME = 'outvers'

function parseDatabaseName(connectionUrl: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(connectionUrl)
  } catch {
    return null
  }
  // pathname is '/<dbname>'; anything else (empty, nested) is not a target.
  const name = parsed.pathname.replace(/^\//, '')
  if (name.length === 0 || name.includes('/')) return null
  return name
}

/**
 * Human-readable target for the dry-run header. Deliberately drops the
 * credentials — this string is printed and may be pasted into an
 * operational record.
 */
export function describeTarget(connectionUrl: string): string {
  try {
    const parsed = new URL(connectionUrl)
    const db = parsed.pathname.replace(/^\//, '') || '(none)'
    return `${parsed.hostname}:${parsed.port || '5432'}/${db}`
  } catch {
    return '(unparseable connection url)'
  }
}

/**
 * Throws unless `connectionUrl` points at the production database.
 * The error names the database it found and the one it required, and
 * never echoes credentials.
 */
export function assertPurgeTarget(connectionUrl: string | undefined): void {
  if (!connectionUrl) {
    throw new Error(
      'Refusing to run: no DATABASE_URL was supplied. The purge requires an ' +
        `explicit connection to the production database "${PRODUCTION_DB_NAME}".`,
    )
  }

  const dbName = parseDatabaseName(connectionUrl)
  if (dbName === null) {
    throw new Error(
      'Refusing to run: could not parse a database name from DATABASE_URL. ' +
        `Expected a URL ending in "/${PRODUCTION_DB_NAME}".`,
    )
  }

  if (dbName !== PRODUCTION_DB_NAME) {
    throw new Error(
      `Refusing to run against database "${dbName}" — the purge only runs ` +
        `against the production database "${PRODUCTION_DB_NAME}" (exact match; ` +
        `note "${PRODUCTION_DB_NAME}" is a prefix of the dev and E2E database ` +
        'names, so a prefix check would not have caught this). ' +
        `Target: ${describeTarget(connectionUrl)}`,
    )
  }
}
