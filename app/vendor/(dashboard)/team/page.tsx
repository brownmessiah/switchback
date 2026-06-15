import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'

import { db } from '@/db/client'
import { users } from '@/db/schema/users'
import { auth } from '@/lib/auth'
import { requireVendorAccess } from '@/lib/auth/permissions'

import { TeamManager, type TeamMemberView } from './team-manager'
import { loadVendorTeam } from './team-core'

/**
 * Vendor Team & Roles surface (issue #05).
 *
 * Lives inside the `(dashboard)` route group, so it inherits the auth +
 * vendor-profile gate and the VendorSidebar/<main> shell. The layout only
 * enforces `bookings:read` (held by every Vendor role), so the team surface
 * MUST re-gate HERE on `team:manage` — owner-only (the matrix grants it via the
 * Owner wildcard; no other role holds it). A non-`team:manage` user (a member,
 * or a non-owner) is `notFound()`'d by the throwing gate, matching how
 * analytics/payouts gate their reads (issue #03 pattern).
 *
 * The Owner is the IMPLICIT account holder (`vendor_profiles.user_id`), never a
 * `vendor_team_members` row — so it is rendered as a protected top row (no
 * Edit/Remove) above the manageable member roster from `loadVendorTeam`.
 */
export default async function VendorTeamPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  const userId = session!.user.id

  // Owner-only gate. Throwing variant → notFound() on denial.
  await requireVendorAccess(db, userId, 'team:manage')

  const t = await getTranslations('VendorTeam')

  const memberRows = await loadVendorTeam(db, userId)

  // Resolve the Owner's display name/email for the protected top row. Falls
  // back to the session name, then a generic Owner label.
  const [ownerUser] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  const ownerName =
    ownerUser?.name?.trim() ||
    ownerUser?.email?.trim() ||
    session!.user.name ||
    t('ownerRowLabel')

  // Serialize roster rows for the client component (Dates → ISO strings).
  const members: TeamMemberView[] = memberRows.map((row) => ({
    memberUserId: row.memberUserId,
    name: row.name,
    email: row.email,
    role: row.role,
    status: row.status,
    lastActiveAt: row.lastActiveAt ? row.lastActiveAt.toISOString() : null,
  }))

  return <TeamManager members={members} ownerName={ownerName} />
}
