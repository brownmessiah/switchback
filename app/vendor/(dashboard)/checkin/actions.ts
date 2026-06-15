'use server'

import { headers } from 'next/headers'
import { z } from 'zod'

import { db as prodDb } from '@/db/client'
import { auth } from '@/lib/auth'

import { executeRecordCheckIn, type RecordCheckInResult } from './checkin-core'
import { resolveCheckInSecret } from './checkin-secret'

/**
 * Server Action boundary for QR check-in (issue #06).
 *
 * SECURITY (issue #03 pattern): this `'use server'` export is a client-callable
 * endpoint, so it (a) derives the trusted session id (never client input),
 * (b) reads the HMAC secret from env at the call site, then (c) delegates to the
 * db-injected core in `./checkin-core`, which performs the REAL authorization —
 * it gates on `bookings:checkin` for the BOOKING'S vendor account, so a member
 * of vendor A cannot check in vendor B's booking (foreign-booking denial). The
 * core is NOT exported from this file.
 *
 * The token is validated as a non-empty string at this boundary (zod); the
 * cryptographic verification lives in the pure token module the core calls.
 */

const tokenSchema = z.string().trim().min(1).max(2048)

export async function recordCheckInAction(token: string): Promise<RecordCheckInResult> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    return { ok: false, error: 'You need to sign in to check in a guest.' }
  }

  const parsed = tokenSchema.safeParse(token)
  if (!parsed.success) {
    return { ok: false, error: 'Enter a check-in code first.' }
  }

  try {
    return await executeRecordCheckIn(
      prodDb,
      session.user.id,
      parsed.data,
      resolveCheckInSecret(),
      new Date(),
    )
  } catch {
    return { ok: false, error: "We couldn't record this check-in. Please try again." }
  }
}
