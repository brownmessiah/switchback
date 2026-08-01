'use server'

import { and, eq, isNull } from 'drizzle-orm'
import { headers } from 'next/headers'

import { db } from '@/db/client'
import { adminProfiles, vendorProfiles } from '@/db/schema'
import { auth } from '@/lib/auth'
import { sanitizeNextPath } from '@/lib/auth/post-auth-redirect'

/**
 * Resolve where a freshly-authenticated User should land, based on their
 * marketplace role profile (ADR-0006). Roles are NOT on the session — they
 * attach via the profile tables — so this must run server-side after sign-in.
 *
 * Precedence: Admin → an allowlisted `next` path → Vendor (with a profile) →
 * Customer (default).
 *
 * `next` carries the intent of someone who was bounced here from an
 * auth-gated page. Without it the vendor funnel dead-ends: a visitor who
 * clicks "Start Vendor Onboarding" signs up, has no vendor_profiles row yet,
 * and so falls through to the CUSTOMER dashboard — never reaching the wizard,
 * never becoming a Vendor, never appearing in the admin dashboard.
 *
 * Admin still wins over `next`: an admin landing anywhere but their console
 * would be a surprising downgrade of an already-privileged session.
 */
export async function resolvePostAuthPath(next?: string): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) return '/sign-in'

  const userId = session.user.id

  const [admin] = await db
    .select({ userId: adminProfiles.userId })
    .from(adminProfiles)
    .where(eq(adminProfiles.userId, userId))
    .limit(1)
  if (admin) return '/admin/dashboard'

  const requested = sanitizeNextPath(next)
  if (requested) return requested

  // Same "active Vendor" predicate as lib/auth/permissions.ts — a soft-closed
  // Vendor is not routed to a dashboard that would bounce them straight back.
  const [vendor] = await db
    .select({ userId: vendorProfiles.userId })
    .from(vendorProfiles)
    .where(and(eq(vendorProfiles.userId, userId), isNull(vendorProfiles.closedAt)))
    .limit(1)
  if (vendor) return '/vendor/dashboard'

  return '/dashboard'
}
