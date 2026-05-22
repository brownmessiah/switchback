import { headers } from 'next/headers'
import { NextResponse } from 'next/server'

import { db } from '@/db/client'
import { env } from '@/lib/env'
import { processRazorpayWebhook } from '@/lib/payments/razorpay-webhook'

/**
 * Razorpay webhook endpoint per ADR-0001. Thin adapter — every concern
 * (signature verification, Redis dedup, DB writes, idempotency) lives
 * in `lib/payments/razorpay-webhook.ts` so it can be tested against a
 * real PGlite-backed db handle without spinning Next.js.
 *
 * Body size: Next.js App Router defaults to 1 MB for route handlers,
 * which is comfortably above Razorpay's webhook payload ceiling (a few
 * KB). We do not raise the limit; large bodies fail before reaching the
 * HMAC step.
 *
 * Response codes are mapped from the result envelope in
 * `processRazorpayWebhook`: 200 success / 200 deduped / 200 ignored /
 * 400 malformed / 401 bad signature / 500 missing-secret or DB error.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const bodyText = await req.text()
  const hdrs = await headers()
  const signature = hdrs.get('x-razorpay-signature') ?? ''
  const eventIdHeader = hdrs.get('x-razorpay-event-id')

  const result = await processRazorpayWebhook({
    db,
    body: bodyText,
    signature,
    eventIdHeader,
    secret: env.RAZORPAY_WEBHOOK_SECRET ?? '',
  })

  return NextResponse.json(result.body, { status: result.status })
}
