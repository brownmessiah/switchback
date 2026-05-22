import { timingSafeEqual } from 'node:crypto'

import { headers } from 'next/headers'
import { NextResponse } from 'next/server'

import { db } from '@/db/client'
import { env } from '@/lib/env'
import { processPartialPayAutocapture } from '@/lib/payments/partial-pay-autocapture'

function safeCompare(a: string, b: string): boolean {
  // Length must be checked first — timingSafeEqual throws on length
  // mismatch, which is itself a side channel.
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) return false
  return timingSafeEqual(aBuf, bBuf)
}

/**
 * Vercel Cron entry — partial-pay T-24h auto-capture per ADR-0001.
 *
 * Scheduled every 15 minutes in `vercel.json`. Authenticated via the
 * `CRON_SECRET` env var: Vercel Cron sends an `authorization: Bearer
 * <CRON_SECRET>` header on every invocation. Any request missing or
 * mismatching that header is rejected with 401 — without a configured
 * secret the route returns 500 (operator must set CRON_SECRET before
 * enabling the cron).
 *
 * The actual logic lives in `lib/payments/partial-pay-autocapture.ts`
 * which is testable against PGlite without a Next.js runtime.
 *
 * Body shape: returns `{ processed, succeeded, failed, skipped }` so
 * the Vercel cron logs are informative for ops triage.
 */
export async function POST(): Promise<NextResponse> {
  const secret = env.CRON_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 500 },
    )
  }

  const hdrs = await headers()
  const authHeader = hdrs.get('authorization') ?? ''
  if (!safeCompare(authHeader, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const result = await processPartialPayAutocapture({ db })
    return NextResponse.json(result, { status: 200 })
  } catch {
    // Internal errors are logged server-side (Sentry); the response
    // body deliberately omits stack / message to avoid leaking internal
    // schema details into Vercel's cron logs.
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
