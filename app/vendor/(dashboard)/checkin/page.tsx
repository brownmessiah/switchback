import { notFound } from 'next/navigation'

import { db } from '@/db/client'
import { requireVendorAccess } from '@/lib/auth/permissions'
import {
  getActingVendorContext,
  getCachedSession,
} from '@/lib/vendor/acting-context'

import { CheckInScanner } from './checkin-scanner'

/**
 * /vendor/checkin — the QR check-in scanner (issue #06).
 *
 * Lives inside the `(dashboard)` route group, so it inherits the auth +
 * vendor-profile gate and the shell. The layout only enforces `bookings:read`
 * (held by every Vendor role), so this surface RE-GATES on `bookings:checkin` —
 * the read gate for reaching the scanner at all. A user who lacks checkin on
 * their OWN account (an Accountant) is `notFound()`'d by the throwing gate.
 * (The recordCheckIn write additionally re-authorizes against the BOOKING'S
 * vendor account — see `checkin-core.ts`.)
 *
 * Reads `?token=` from the deep-link the customer's QR encodes; the scanner
 * client component auto-submits it once and also offers manual paste.
 */
export default async function VendorCheckinPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // Single session read (issue #11 FIX 4): `getCachedSession` is `cache()`-
  // wrapped, so this read and the one inside `getActingVendorContext` below
  // collapse to ONE memoized call — no redundant double session read.
  const session = await getCachedSession()
  if (!session?.user) notFound()
  const acting = session.user.id

  // Resolve the acting shop (issue #11): owner → own account; member (Guide /
  // Booking Staff / Manager) → the shop they belong to.
  const { vendorUserId: shop } = await getActingVendorContext()

  // Read gate: reaching the scanner requires bookings:checkin on the RESOLVED
  // shop (a Guide of the shop passes; an Accountant does not). Throwing variant
  // → notFound() on denial. The recordCheckIn WRITE additionally re-authorizes
  // against the SCANNED booking's own vendor account (per-booking authz in
  // checkin-core.ts), so this page gate is the read-bound only.
  await requireVendorAccess(db, acting, 'bookings:checkin', shop)

  const params = await searchParams
  const rawToken = params.token
  const initialToken = typeof rawToken === 'string' && rawToken.length > 0 ? rawToken : null

  return <CheckInScanner initialToken={initialToken} />
}
