import { headers } from 'next/headers'
import { NextResponse } from 'next/server'

import { db } from '@/db/client'
import { env } from '@/lib/env'
import { processRazorpayXWebhook } from '@/lib/payments/razorpayx-webhook'

/**
 * Razorpay X payout webhook endpoint per ADR-0016 (2026-06-18 amendment, D4).
 *
 * Thin adapter — every concern (signature verification, Redis dedup, status
 * cascade, idempotency, reconciliation) lives in
 * `lib/payments/razorpayx-webhook.ts` so it can be tested against a real
 * PGlite-backed db handle without spinning Next.js.
 *
 * The X trust boundary is DISTINCT from the PG (collection) one: this route
 * verifies with `RAZORPAYX_WEBHOOK_SECRET`, NOT the PG `RAZORPAY_WEBHOOK_SECRET`.
 * Razorpay X uses the same header names (`x-razorpay-signature`,
 * `x-razorpay-event-id`) as the PG webhook.
 *
 * Response codes are mapped from the result envelope in
 * `processRazorpayXWebhook`: 200 success / 200 deduped / 200 ignored /
 * 200 unmatched / 400 malformed / 401 bad signature / 500 missing-secret or
 * DB error.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const bodyText = await req.text()
  const hdrs = await headers()
  const signature = hdrs.get('x-razorpay-signature') ?? ''
  const eventIdHeader = hdrs.get('x-razorpay-event-id')

  const result = await processRazorpayXWebhook({
    db,
    body: bodyText,
    signature,
    eventIdHeader,
    secret: env.RAZORPAYX_WEBHOOK_SECRET ?? '',
  })

  return NextResponse.json(result.body, { status: result.status })
}
