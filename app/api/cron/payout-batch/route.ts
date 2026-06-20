import { timingSafeEqual } from 'node:crypto'

import { headers } from 'next/headers'
import { NextResponse } from 'next/server'

import { db } from '@/db/client'
import { env } from '@/lib/env'
import { processPayoutBatch } from '@/lib/payments/payout-batch'

function safeCompare(a: string, b: string): boolean {
  // Length must be checked first — timingSafeEqual throws on length
  // mismatch, which is itself a side channel.
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)
  if (aBuf.length !== bBuf.length) return false
  return timingSafeEqual(aBuf, bBuf)
}

/**
 * Vercel Cron entry — Payout Batch send per ADR-0016 (2026-06-18 amendment,
 * D1+D3).
 *
 * Scheduled at 5pm IST (`30 11 * * *` UTC) in `vercel.json`. Authenticated via
 * the `CRON_SECRET` env var exactly like the partial-pay-autocapture route:
 * Vercel Cron sends `authorization: Bearer <CRON_SECRET>` on every invocation.
 * A request missing or mismatching that header is rejected with 401 (constant-
 * time compare); without a configured secret the route returns 500 (operator
 * must set CRON_SECRET before enabling the cron).
 *
 * The Payout Batch send logic lives in `lib/payments/payout-batch.ts`, which is
 * testable against PGlite with a stubbed Razorpay X client (no Next.js runtime).
 *
 * Body shape: returns `{ batchesPlanned, sent, skippedAdminQueue, alreadySent }`
 * so the Vercel cron logs are informative for ops triage.
 */
export async function POST(): Promise<NextResponse> {
  // ADR-0019 — env-gated OFF on the public web service (404). Only the private
  // cron service sets RUN_CRON_ROUTES=true; CRON_SECRET below is defense-in-depth.
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
  const authHeader = hdrs.get('authorization') ?? ''
  if (!safeCompare(authHeader, `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const result = await processPayoutBatch({ db })
    return NextResponse.json(result, { status: 200 })
  } catch {
    // Internal errors are logged server-side (Sentry); the response body
    // deliberately omits stack / message to avoid leaking internal schema
    // details into Vercel's cron logs.
    return NextResponse.json({ error: 'internal error' }, { status: 500 })
  }
}
