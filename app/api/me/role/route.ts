import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'

import { db } from '@/db/client'
import { adminProfiles, vendorProfiles } from '@/db/schema'
import { auth } from '@/lib/auth'

/**
 * GET /api/me/role — the current session user's marketplace role flags.
 *
 * Roles are NOT on the better-auth user (ADR-0006: they attach via the profile
 * tables). The client account menu uses this to show the RIGHT dashboard link
 * (Admin vs Vendor) instead of a hardcoded "Vendor dashboard" for everyone.
 * Returns all-false when logged out.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const session = await auth.api.getSession({ headers: request.headers })
  if (!session?.user) {
    return NextResponse.json({ isAdmin: false, isVendor: false })
  }

  const userId = session.user.id
  const [admin] = await db
    .select({ userId: adminProfiles.userId })
    .from(adminProfiles)
    .where(eq(adminProfiles.userId, userId))
    .limit(1)
  const [vendor] = await db
    .select({ userId: vendorProfiles.userId })
    .from(vendorProfiles)
    .where(eq(vendorProfiles.userId, userId))
    .limit(1)

  return NextResponse.json({ isAdmin: Boolean(admin), isVendor: Boolean(vendor) })
}
