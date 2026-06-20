import { NextResponse } from 'next/server'

import { db } from '@/db/client'
import { pingDatabase } from '@/lib/health/db-ping'

/**
 * Unauthenticated health endpoint (ADR-0019).
 *
 *   GET /api/healthz           → DEEP: `SELECT 1` (short timeout). 200 when Cloud
 *                                SQL is reachable, else 503. Used by the Cloud Run
 *                                STARTUP probe + the deploy smoke check, so an
 *                                instance only takes traffic once the DB is up.
 *   GET /api/healthz?shallow   → SHALLOW: process-up only, no DB. Used by the
 *                                liveness probe + the LB backend check, so a
 *                                transient DB blip doesn't down every instance.
 *
 * Public + never cached. `/api/*` is not under the `[locale]` segment, so it is
 * never locale-rewritten.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: Request): Promise<NextResponse> {
  const shallow = new URL(request.url).searchParams.has('shallow')

  if (shallow) {
    return NextResponse.json({ status: 'ok', mode: 'shallow' }, { status: 200 })
  }

  const healthy = await pingDatabase(db)
  return NextResponse.json(
    { status: healthy ? 'ok' : 'unhealthy', mode: 'deep' },
    { status: healthy ? 200 : 503 },
  )
}
