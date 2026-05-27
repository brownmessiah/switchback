import { eq } from 'drizzle-orm'
import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { db } from '@/db/client'
import { users, vendorProfiles } from '@/db/schema'

const KYC_VARIANTS: Record<string, 'default' | 'secondary' | 'outline'> = {
  business: 'default',
  identity: 'secondary',
  phone: 'outline',
}

export default async function AdminVendorsPage() {
  const vendors = await db
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
        <h1 className="text-2xl font-semibold tracking-tight">Vendors</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {vendors.length} registered vendor{vendors.length === 1 ? '' : 's'}
        </p>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Business</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>KYC</TableHead>
                <TableHead>Commission</TableHead>
                <TableHead>SLA</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vendors.map((v) => (
                <TableRow key={v.userId}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/admin/vendors/${v.userId}`}
                      className="hover:underline"
                    >
                      {v.businessName}
                    </Link>
                    {v.suspended && (
                      <Badge variant="destructive" className="ml-2 text-xs">
                        Suspended
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {v.userEmail ?? v.userName ?? '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={KYC_VARIANTS[v.kycTier] ?? 'outline'} className="capitalize text-xs">
                      {v.kycTier}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{v.commissionRate}%</TableCell>
                  <TableCell className="text-sm">
                    {Math.floor(Number(v.responseTimeSlaScore))}%
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(v.createdAt).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
