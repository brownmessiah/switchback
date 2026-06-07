'use server'

import { db } from '@/db/client'

import { subscribeNewsletter, type SubscribeResult } from './subscribe'

/**
 * Thin Next.js Server Action boundary for the footer newsletter form (Issue 01).
 *
 * All validation + persistence lives in the pure `subscribeNewsletter`
 * (lib/newsletter/subscribe.ts), unit-tested against PGlite. This wrapper exists
 * only to expose that core across the server-action boundary, bound to the
 * production `db`. It returns the typed discriminated result and never throws to
 * the client — an unexpected fault degrades to `{ status: 'error' }`.
 *
 * Per Next's server-actions loader constraints, this module exports ONLY async
 * Server Functions; consumers import the `SubscribeResult` TYPE straight from
 * lib/newsletter/subscribe.
 */
export async function subscribeNewsletterAction(
  email: string,
  opts?: { source?: string; locale?: string },
): Promise<SubscribeResult> {
  try {
    return await subscribeNewsletter(db, email, opts)
  } catch {
    return { status: 'error' }
  }
}
