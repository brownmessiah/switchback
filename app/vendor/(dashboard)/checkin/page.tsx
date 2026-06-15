import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import { requireVendorAccess } from '@/lib/auth/permissions'

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
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) notFound()
  const userId = session.user.id

  // Read gate: a user reaching the scanner must hold bookings:checkin on their
  // own account. Throwing variant → notFound() on denial.
  await requireVendorAccess(db, userId, 'bookings:checkin')

  const params = await searchParams
  const rawToken = params.token
  const initialToken = typeof rawToken === 'string' && rawToken.length > 0 ? rawToken : null

  return <CheckInScanner initialToken={initialToken} />
}
