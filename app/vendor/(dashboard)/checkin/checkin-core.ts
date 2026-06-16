import { and, eq, isNull } from 'drizzle-orm'

import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { hasVendorAccess } from '@/lib/auth/permissions'
import { verifyCheckInToken } from '@/lib/bookings/checkin-token'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

/**
 * QR check-in core (issue #06). DB-injected, framework-free.
 *
 * This module is DELIBERATELY NOT a `'use server'` file: it takes an explicit
 * `db` handle, a trusted session-derived `actingUserId`, the scanned `token`,
 * the env `secret`, and the clock `now`. The thin Server Action wrapper in
 * `./actions.ts` derives the session id + reads the secret from env, then
 * delegates here — so nothing in this file is a client-callable endpoint
 * (issue #03 security pattern).
 *
 * Authorization is against the BOOKING'S vendor account: we verify the token,
 * load the booking, resolve its vendor (`experiences.vendor_user_id`), then gate
 * on `bookings:checkin` for THAT account. This single check both (a) requires
 * the checkin permission (Owner / Manager / Booking Staff / Guide — NOT
 * Accountant) and (b) blocks a FOREIGN booking (a vendor with no role on the
 * booking's account resolves to no access → denied).
 *
 * Check-in is a NEW timestamp, NOT a lifecycle state (ADR-0003 untouched): we
 * set `checked_in_at` and NEVER mutate `state`. Idempotent — a re-scan returns
 * `alreadyCheckedIn: true` with the existing timestamp and does not overwrite.
 *
 * Error envelopes are SANITIZED: every expected failure (bad/expired/foreign
 * token, missing booking, denied access) returns the same generic
 * "invalid code" message, so the response never reveals whether a bookingId
 * exists or distinguishes a permission denial from a bad token.
 */

export type RecordCheckInResult =
  | { ok: true; alreadyCheckedIn: boolean; bookingId: string }
  | { ok: false; error: string }

/**
 * Single sanitized failure message for every expected denial/validation case.
 * Deliberately uniform: a forged token, an expired token, a non-existent
 * booking, and an unauthorized actor are indistinguishable to the client.
 */
const INVALID_CODE: RecordCheckInResult = {
  ok: false,
  error: 'This check-in code is invalid, expired, or not yours to scan.',
}

/**
 * Verify + record a customer's arrival.
 *
 * @param db            Drizzle handle (prod db or PGlite test db).
 * @param actingUserId  Trusted, session-derived id (never client input).
 * @param token         The scanned signed token.
 * @param secret        HMAC secret (read from env at the call site).
 * @param now           Clock; the timestamp written on first check-in.
 */
export async function executeRecordCheckIn(
  db: DBOrTx,
  actingUserId: string,
  token: string,
  secret: string,
  now: Date,
): Promise<RecordCheckInResult> {
  // 1. Verify the token (pure module). Compare against the clock as epoch-ms.
  const verified = verifyCheckInToken(token, secret, now.getTime())
  if (!verified.ok) return INVALID_CODE

  // 2. Load the booking + its owning vendor account (experiences.vendor_user_id).
  const [booking] = await db
    .select({
      id: bookings.id,
      checkedInAt: bookings.checkedInAt,
      vendorUserId: experiences.vendorUserId,
    })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .where(eq(bookings.id, verified.bookingId))
    .limit(1)

  // Sanitized: a non-existent booking is indistinguishable from a bad token.
  if (!booking) return INVALID_CODE

  // 3. Authorize against the BOOKING'S vendor account. A member/owner of THAT
  //    account who holds `bookings:checkin` passes; everyone else (Accountant,
  //    or a member of a different vendor — foreign booking) is denied.
  const authorized = await hasVendorAccess(
    db,
    actingUserId,
    'bookings:checkin',
    booking.vendorUserId,
  )
  if (!authorized) return INVALID_CODE

  // 4. Idempotent: if already checked in, return the existing state. Never
  //    overwrite the original timestamp; never touch `state`.
  if (booking.checkedInAt) {
    return { ok: true, alreadyCheckedIn: true, bookingId: booking.id }
  }

  // 5. First check-in: set the timestamp ONLY. `state` is UNCHANGED. The
  //    guarded WHERE (`checked_in_at IS NULL`) makes a concurrent double-scan a
  //    no-op rather than a clobber.
  await db
    .update(bookings)
    .set({ checkedInAt: now })
    .where(and(eq(bookings.id, booking.id), isNull(bookings.checkedInAt)))

  return { ok: true, alreadyCheckedIn: false, bookingId: booking.id }
}
