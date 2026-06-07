import { z } from 'zod'

import { newsletterSubscribers } from '@/db/schema'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

/**
 * Newsletter capture core (Issue 01).
 *
 * The pure, testable DB core behind the footer newsletter form. It validates
 * the email (Zod) at the boundary, normalizes + de-dupes on email, persists,
 * and returns a discriminated result — with NO UI knowledge inside the module.
 *
 * A newsletter subscriber is a *visitor* (may or may not be a Customer); this
 * writes the standalone `newsletter_subscribers` marketing-capture table, never
 * a User/Customer/Account row.
 *
 * De-dup is enforced at the DB: the normalized `email` column is unique and the
 * insert uses `onConflictDoNothing`, so a duplicate (any case/whitespace
 * variant) is a no-op that `returning()` reports as an empty array — no
 * read-then-write race. All DB work is wrapped so a persistence fault returns
 * `{ status: 'error' }` rather than throwing to the caller.
 *
 * The Next.js `'use server'` wrapper lives in lib/newsletter/actions.ts.
 */

export const newsletterSchema = z.object({
  email: z.string().trim().email().max(254),
})

export type SubscribeResult =
  | { status: 'success' }
  | { status: 'invalid' }
  | { status: 'already-subscribed' }
  | { status: 'error' }

/**
 * Validate, normalize, and persist a newsletter subscription.
 *
 *   - Zod failure → `{ status: 'invalid' }` (persist nothing).
 *   - New email → insert one row, `{ status: 'success' }`.
 *   - Existing email (any case/whitespace) → conflict no-op,
 *     `{ status: 'already-subscribed' }` (no second row).
 *   - Any thrown DB fault → `{ status: 'error' }` (never rethrown).
 */
export async function subscribeNewsletter(
  db: DBOrTx,
  rawEmail: string,
  opts?: { source?: string; locale?: string },
): Promise<SubscribeResult> {
  const parsed = newsletterSchema.safeParse({ email: rawEmail })
  if (!parsed.success) {
    return { status: 'invalid' }
  }

  const email = parsed.data.email.trim().toLowerCase()

  try {
    const inserted = await db
      .insert(newsletterSubscribers)
      .values({ email, source: opts?.source, locale: opts?.locale })
      .onConflictDoNothing({ target: newsletterSubscribers.email })
      .returning({ id: newsletterSubscribers.id })

    if (inserted.length > 0) {
      return { status: 'success' }
    }
    return { status: 'already-subscribed' }
  } catch {
    return { status: 'error' }
  }
}
