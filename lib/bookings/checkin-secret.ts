/**
 * Resolve the HMAC secret for check-in tokens (issue #06).
 *
 * Read from env at the CALL SITE and passed into the pure token module — the
 * token module itself never reads env (keeps it pure + testable). Prefers a
 * dedicated `CHECKIN_TOKEN_SECRET`, falling back to `BETTER_AUTH_SECRET` (always
 * present, ≥32 chars, validated in `lib/env.ts`). Both the customer
 * confirmation page (which SIGNS the QR) and the check-in core (which VERIFIES)
 * resolve the secret here, so they can never drift.
 *
 * Lives in `lib/bookings/` (alongside `checkin-token.ts` / `checkin-qr.ts`) so
 * both the customer surface (`app/(app)/...`) and the vendor surface
 * (`app/vendor/...`) import it without crossing a route-group boundary.
 */
export function resolveCheckInSecret(): string {
  const secret = process.env.CHECKIN_TOKEN_SECRET ?? process.env.BETTER_AUTH_SECRET
  if (!secret) {
    throw new Error(
      'No check-in token secret configured (CHECKIN_TOKEN_SECRET / BETTER_AUTH_SECRET).',
    )
  }
  return secret
}
