import { eq, sql } from 'drizzle-orm'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import { db } from '@/db/client'
import { users, vendorProfiles } from '@/db/schema'
import { auth } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/permissions'

import { VendorsTable, type VendorsTableRow } from './vendors-table'

export default async function AdminVendorsPage() {
  // The admin layout only proves an admin_profiles row EXISTS; per-page
  // permission checks are the page's job (see the contract comment in
  // app/admin/layout.tsx). Without this a sub-admin lacking the 'vendors'
  // permission could read every Vendor's name, email, KYC tier and commission
  // rate from this list — even though the detail page correctly 404s them.
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) notFound()
  await requirePermission(db, session.user.id, 'vendors')

  const vendors: VendorsTableRow[] = await db
    .select({
      userId: vendorProfiles.userId,
      businessName: vendorProfiles.businessName,
      slug: vendorProfiles.slug,
      kycTier: vendorProfiles.kycTier,
      applicationStatus: vendorProfiles.applicationStatus,
      commissionRate: vendorProfiles.commissionRate,
      responseTimeSlaScore: vendorProfiles.responseTimeSlaScore,
      suspended: vendorProfiles.suspended,
      createdAt: vendorProfiles.createdAt,
      userName: users.name,
      userEmail: users.email,
    })
    .from(vendorProfiles)
    .innerJoin(users, eq(vendorProfiles.userId, users.id))
    // Vendors waiting on a decision first — this page is a work queue, and the
    // newest applicant used to land at the BOTTOM of an unpaginated list.
    // Within each group, oldest-waiting first so nobody is starved.
    .orderBy(
      sql`CASE WHEN ${vendorProfiles.applicationStatus} = 'pending' THEN 0 ELSE 1 END`,
      vendorProfiles.createdAt,
    )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-h1 font-semibold tracking-tight">Vendors</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {vendors.length} registered vendor{vendors.length === 1 ? '' : 's'}
        </p>
      </div>

      <VendorsTable rows={vendors} />
    </div>
  )
}
