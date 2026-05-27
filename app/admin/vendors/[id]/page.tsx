import { count, eq, sql } from 'drizzle-orm'
import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { db } from '@/db/client'
import { bookings, experiences, users, vendorProfiles } from '@/db/schema'
import { auth } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/permissions'

import { CommissionRateForm } from './commission-rate-form'
import { KycApprovalForm } from './kyc-approval-form'
import { SuspendToggleForm } from './suspend-toggle-form'

interface AdminVendorDetailPageProps {
  params: Promise<{ id: string }>
}

export default async function AdminVendorDetailPage({
  params,
}: AdminVendorDetailPageProps) {
  const { id: vendorUserId } = await params

  // Auth + permission guard
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) notFound()
  await requirePermission(db, session.user.id, 'vendors')

  // Fetch vendor + user data
  const [vendorRow] = await db
    .select({
      userId: vendorProfiles.userId,
      businessName: vendorProfiles.businessName,
      slug: vendorProfiles.slug,
      about: vendorProfiles.about,
      kycTier: vendorProfiles.kycTier,
      pan: vendorProfiles.pan,
      gstin: vendorProfiles.gstin,
      udyamId: vendorProfiles.udyamId,
      aadhaarVerifiedAt: vendorProfiles.aadhaarVerifiedAt,
      videoCallVerifiedAt: vendorProfiles.videoCallVerifiedAt,
      commissionRate: vendorProfiles.commissionRate,
      payoutMethod: vendorProfiles.payoutMethod,
      payoutDestination: vendorProfiles.payoutDestination,
      responseTimeSlaScore: vendorProfiles.responseTimeSlaScore,
      suspended: vendorProfiles.suspended,
      manualPayoutsRemaining: vendorProfiles.manualPayoutsRemaining,
      createdAt: vendorProfiles.createdAt,
      userName: users.name,
      userEmail: users.email,
      userPhone: users.phoneNumber,
    })
    .from(vendorProfiles)
    .innerJoin(users, eq(vendorProfiles.userId, users.id))
    .where(eq(vendorProfiles.userId, vendorUserId))
    .limit(1)

  if (!vendorRow) notFound()

  // Fetch summary counts in parallel
  const [listingCountResult, bookingCountResult, totalRevenueResult] = await Promise.all([
    db
      .select({ value: count() })
      .from(experiences)
      .where(eq(experiences.vendorUserId, vendorUserId)),
    db
      .select({ value: count() })
      .from(bookings)
      .where(
        eq(
          bookings.experienceId,
          sql`ANY(SELECT id FROM experiences WHERE vendor_user_id = ${vendorUserId})`,
        ),
      )
      .catch(() => [{ value: 0 }]),
    db
      .select({
        value: sql<string>`COALESCE(SUM(${bookings.grossTotalSnapshot}::numeric), 0)`.as('total'),
      })
      .from(bookings)
      .where(
        eq(
          bookings.experienceId,
          sql`ANY(SELECT id FROM experiences WHERE vendor_user_id = ${vendorUserId})`,
        ),
      )
      .catch(() => [{ value: '0' }]),
  ])

  const listingCount = listingCountResult[0]?.value ?? 0
  const bookingCount = bookingCountResult[0]?.value ?? 0
  const totalRevenue = totalRevenueResult[0]?.value ?? '0'

  const KYC_DOCS: { label: string; value: string | null | undefined; type?: 'date' }[] = [
    { label: 'PAN', value: vendorRow.pan },
    { label: 'GSTIN', value: vendorRow.gstin },
    { label: 'Udyam ID', value: vendorRow.udyamId },
    {
      label: 'Aadhaar Verified',
      value: vendorRow.aadhaarVerifiedAt?.toLocaleDateString('en-IN') ?? null,
    },
    {
      label: 'Video Call Verified',
      value: vendorRow.videoCallVerifiedAt?.toLocaleDateString('en-IN') ?? null,
    },
  ]

  const payoutDest = vendorRow.payoutDestination as Record<string, string> | null

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href="/admin/vendors" />}>
              Vendors
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{vendorRow.businessName}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {vendorRow.businessName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {vendorRow.userEmail ?? vendorRow.userName ?? vendorRow.userPhone ?? '—'}
            {' · '}
            Slug: <code className="rounded bg-muted px-1 text-xs">{vendorRow.slug}</code>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {vendorRow.suspended && (
            <Badge variant="destructive">Suspended</Badge>
          )}
          <Badge variant={vendorRow.kycTier === 'business' ? 'default' : 'secondary'} className="capitalize">
            {vendorRow.kycTier}
          </Badge>
        </div>
      </div>

      <Separator />

      {/* Stats row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-muted-foreground">Listings</p>
            <p className="text-2xl font-semibold">{listingCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-muted-foreground">Bookings</p>
            <p className="text-2xl font-semibold">{bookingCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-muted-foreground">Total Revenue</p>
            <p className="text-2xl font-semibold">
              Rs.{Number(totalRevenue).toLocaleString('en-IN', { minimumFractionDigits: 0 })}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-muted-foreground">SLA Score</p>
            <p className="text-2xl font-semibold">
              {Math.floor(Number(vendorRow.responseTimeSlaScore))}%
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Detail grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Business Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Business Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <DetailRow label="Business Name" value={vendorRow.businessName} />
            <DetailRow label="Contact" value={vendorRow.userEmail ?? vendorRow.userPhone ?? '—'} />
            <DetailRow label="Name" value={vendorRow.userName ?? '—'} />
            <DetailRow label="About" value={vendorRow.about ?? '—'} />
            <DetailRow label="Joined" value={vendorRow.createdAt.toLocaleDateString('en-IN')} />
          </CardContent>
        </Card>

        {/* KYC Documents */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">KYC Documents</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {KYC_DOCS.map((doc) => (
              <DetailRow key={doc.label} label={doc.label} value={doc.value ?? '—'} />
            ))}
          </CardContent>
        </Card>

        {/* Commission Rate — inline edit */}
        <CommissionRateForm
          vendorUserId={vendorRow.userId}
          currentRate={vendorRow.commissionRate}
        />

        {/* KYC Tier Management */}
        <KycApprovalForm
          vendorUserId={vendorRow.userId}
          currentTier={vendorRow.kycTier}
        />

        {/* Payout Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payout Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <DetailRow label="Method" value={vendorRow.payoutMethod ?? 'Not configured'} />
            {vendorRow.payoutMethod === 'upi' && payoutDest?.vpa && (
              <DetailRow label="UPI VPA" value={payoutDest.vpa} />
            )}
            {vendorRow.payoutMethod === 'bank_account' && payoutDest && (
              <>
                <DetailRow label="Account Holder" value={payoutDest.accountHolderName ?? '—'} />
                <DetailRow label="Account Number" value={payoutDest.accountNumber ?? '—'} />
                <DetailRow label="IFSC" value={payoutDest.ifsc ?? '—'} />
              </>
            )}
            <DetailRow
              label="Manual Payouts Remaining"
              value={String(vendorRow.manualPayoutsRemaining)}
            />
          </CardContent>
        </Card>

        {/* Suspend / Reactivate */}
        <SuspendToggleForm
          vendorUserId={vendorRow.userId}
          suspended={vendorRow.suspended}
        />
      </div>
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <span className="text-sm text-right">{value}</span>
    </div>
  )
}
