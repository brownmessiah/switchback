'use server'

import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'

import { db } from '@/db/client'
import { adminProfiles, vendorProfiles } from '@/db/schema'
import { auth } from '@/lib/auth'

/**
 * Resolve where a freshly-authenticated User should land, based on their
 * marketplace role profile (ADR-0006). Roles are NOT on the session — they
 * attach via the profile tables — so this must run server-side after sign-in.
 *
 * Precedence: Admin → Vendor (with a profile) → Customer (default). A vendor
 * User without a vendor_profiles row falls through to /dashboard; the vendor
 * dashboard layout itself bounces a profile-less vendor to /vendor/onboarding.
 */
export async function resolvePostAuthPath(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return '/sign-in'

  const userId = session.user.id

  const [admin] = await db
    .select({ userId: adminProfiles.userId })
    .from(adminProfiles)
    .where(eq(adminProfiles.userId, userId))
    .limit(1)
  if (admin) return '/admin/dashboard'

  const [vendor] = await db
    .select({ userId: vendorProfiles.userId })
    .from(vendorProfiles)
    .where(eq(vendorProfiles.userId, userId))
    .limit(1)
  if (vendor) return '/vendor/dashboard'

  return '/dashboard'
}
