import { sql } from 'drizzle-orm'

/** Deep health-check DB timeout (ms). Short so a probe never hangs. */
export const HEALTHZ_DB_TIMEOUT_MS = 3000

/** Minimal shape the ping needs — satisfied by the drizzle db handle. */
interface Pingable {
  execute(query: ReturnType<typeof sql>): Promise<unknown>
}

/**
 * Deep DB probe: runs `SELECT 1` with a short timeout. Returns true only if the
 * database answered in time, false on error OR timeout (never hangs). Used by the
 * /api/healthz deep check, the Cloud Run startup probe, and the deploy smoke test
 * so an instance only enters rotation once Cloud SQL is reachable (ADR-0019).
 */
export async function pingDatabase(
  db: Pingable,
  timeoutMs: number = HEALTHZ_DB_TIMEOUT_MS,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      db.execute(sql`SELECT 1`),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('healthz: DB ping timeout')), timeoutMs)
      }),
    ])
    return true
  } catch {
    return false
  } finally {
    if (timer) clearTimeout(timer)
  }
}
