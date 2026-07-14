import { headers } from 'next/headers'
import { NextResponse } from 'next/server'

import { db } from '@/db/client'
import { materializeAllSlots } from '@/lib/availability/materialize-all'
import { isCronAuthorized } from '@/lib/cron/auth'
import { env } from '@/lib/env'

/**
 * Cron entry — rolling slot materialization (ADR-0020 launch dependency).
 *
 * Date-availability search only surfaces Experiences whose slots are
 * materialized; without this sweep the ~90-day window shrank silently for
 * listings whose vendors weren't active. Scheduled daily at 2:30 UTC
 * (8:00 IST) in `vercel.json`; authenticated exactly like the sibling cron
 * routes (RUN_CRON_ROUTES gate + `authorization: Bearer <CRON_SECRET>`,
 * constant-time compare).
 *
 * The sweep logic lives in `lib/availability/materialize-all.ts` (PGlite-
 * testable); it is idempotent — re-runs create nothing new.
 */
export async function POST(): Promise<NextResponse> {
  if (env.RUN_CRON_ROUTES !== 'true') {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const secret = env.CRON_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 500 },
    )
  }

  const hdrs = await headers()
  if (!isCronAuthorized((name) => hdrs.get(name), secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const result = await materializeAllSlots(db)
    return NextResponse.json(result, { status: 200 })
  } catch (err) {
    // Log server-side; the response body omits details so schema internals
    // never leak into cron logs.
    console.error('[materialize-slots] cron failed', err)
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
