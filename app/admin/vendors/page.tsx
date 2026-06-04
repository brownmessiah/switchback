import { eq } from 'drizzle-orm'

import { db } from '@/db/client'
import { users, vendorProfiles } from '@/db/schema'

import { VendorsTable, type VendorsTableRow } from './vendors-table'

export default async function AdminVendorsPage() {
  const vendors: VendorsTableRow[] = await db
    .select({
      userId: vendorProfiles.userId,
      businessName: vendorProfiles.businessName,
      slug: vendorProfiles.slug,
      kycTier: vendorProfiles.kycTier,
      commissionRate: vendorProfiles.commissionRate,
      responseTimeSlaScore: vendorProfiles.responseTimeSlaScore,
      suspended: vendorProfiles.suspended,
      createdAt: vendorProfiles.createdAt,
      userName: users.name,
      userEmail: users.email,
    })
    .from(vendorProfiles)
    .innerJoin(users, eq(vendorProfiles.userId, users.id))
    .orderBy(vendorProfiles.createdAt)

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
