import { and, count, desc, eq, sql } from 'drizzle-orm'
import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/db/client'
import { auditLogs } from '@/db/schema/audit-logs'
import { bookings, experiences, users, vendorProfiles } from '@/db/schema'
import { auth } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/permissions'
import { listKycDocumentsForVendor } from '@/lib/vendor/kyc-documents'

import { AdminStatusBadge } from '../../_components/admin-status-badge'
import { CommissionRateForm } from './commission-rate-form'
import { KycApprovalForm } from './kyc-approval-form'
import { KycTierLadder } from './kyc-tier-ladder'
import { SuspendToggleForm } from './suspend-toggle-form'
import { VendorEvidenceCard } from './vendor-evidence-card'

interface AdminVendorDetailPageProps {
  params: Promise<{ id: string }>
}

const TIER_LABEL: Record<string, string> = {
  phone: 'Phone tier',
  identity: 'Identity verified Vendor',
  business: 'Business verified Vendor',
}

const KYC_DOC_LABEL: Record<string, string> = {
  government_id: 'Government ID',
  selfie: 'Selfie holding ID',
  pan_card: 'PAN card',
  business_proof: 'Business proof',
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

  // Fetch summary counts + the vendor's audit trail in parallel
  const [listingCountResult, bookingCountResult, totalRevenueResult, auditRows] =
    await Promise.all([
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
      // Read-only audit trail for THIS vendor (fold C). entity_type/entity_id
      // are exactly what the admin Server Actions write (vendor_profile / userId).
      db
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          payload: auditLogs.payload,
          createdAt: auditLogs.createdAt,
          actorEmail: users.email,
          actorName: users.name,
          actorUserId: auditLogs.actorUserId,
        })
        .from(auditLogs)
        .leftJoin(users, eq(auditLogs.actorUserId, users.id))
        .where(
          and(
            eq(auditLogs.entityType, 'vendor_profile'),
            eq(auditLogs.entityId, vendorUserId),
          ),
        )
        .orderBy(desc(auditLogs.createdAt))
        .limit(20)
        .catch(() => []),
    ])

  const kycDocuments = await listKycDocumentsForVendor(db, vendorUserId)

  const listingCount = listingCountResult[0]?.value ?? 0
  const bookingCount = bookingCountResult[0]?.value ?? 0
  const totalRevenue = totalRevenueResult[0]?.value ?? '0'

  const payoutDest = vendorRow.payoutDestination as Record<string, string> | null
  const payoutConfigured = Boolean(vendorRow.payoutMethod)
  // A payout-eligible tier (identity/business) with no payout configured is a
  // trust-factor flag the reviewer needs (ADR-0007: those tiers receive Payouts).
  const payoutFlag = vendorRow.kycTier !== 'phone' && !payoutConfigured

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href="/admin/vendors" />}>Vendors</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{vendorRow.businessName}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            {vendorRow.businessName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {vendorRow.userEmail ?? vendorRow.userName ?? vendorRow.userPhone ?? 'No contact'}
            {' · '}Slug:{' '}
            <code className="rounded bg-muted px-1 text-xs">{vendorRow.slug}</code>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {vendorRow.suspended && (
            <AdminStatusBadge status="rejected" label="Suspended" />
          )}
          <AdminStatusBadge
            status={vendorRow.kycTier}
            label={TIER_LABEL[vendorRow.kycTier] ?? vendorRow.kycTier}
          />
        </div>
      </div>

      {/* Two-pane review console: evidence (left) + decision rail (right) */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* ── LEFT: evidence pane ─────────────────────────────────────── */}
        <div className="space-y-6">
          <section className="space-y-3" aria-label="KYC evidence">
            <h2 className="font-heading text-base font-semibold">KYC Documents</h2>
            <p className="text-sm text-muted-foreground">
              Review the evidence the Vendor submitted before promoting their tier.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <VendorEvidenceCard
                testId="evidence-pan"
                label="PAN"
                kind="value"
                value={vendorRow.pan}
              />
              <VendorEvidenceCard
                testId="evidence-gstin"
                label="GSTIN"
                kind="value"
                value={vendorRow.gstin}
              />
              <VendorEvidenceCard
                testId="evidence-udyam"
                label="Udyam ID"
                kind="value"
                value={vendorRow.udyamId}
              />
              <VendorEvidenceCard
                testId="evidence-aadhaar"
                label="Aadhaar"
                kind="timestamp"
                verifiedAt={vendorRow.aadhaarVerifiedAt}
              />
              <VendorEvidenceCard
                testId="evidence-videocall"
                label="Video call"
                kind="timestamp"
                verifiedAt={vendorRow.videoCallVerifiedAt}
              />
            </div>
          </section>

          {/* ADR-0007 interim path: the documents the Vendor actually uploaded.
              Each link goes through the admin-gated route, which re-checks the
              'vendors' permission and mints a short-lived signed URL — the
              documents are never publicly reachable. */}
          <section className="space-y-3" aria-label="KYC documents">
            <h2 className="font-heading text-base font-semibold">Uploaded documents</h2>
            {kycDocuments.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                This Vendor has not uploaded any verification documents yet.
              </p>
            ) : (
              <ul data-testid="vendor-kyc-documents" className="divide-y rounded-[var(--radius-card)] border">
                {kycDocuments.map((doc) => (
                  <li key={doc.id} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{KYC_DOC_LABEL[doc.kind] ?? doc.kind}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {doc.originalFilename ?? doc.storageKey} ·{' '}
                        {Math.max(1, Math.round(doc.sizeBytes / 1024))} KB
                      </p>
                    </div>
                    <a
                      className="shrink-0 text-sm font-medium underline underline-offset-4"
                      href={`/api/admin/kyc-document?key=${encodeURIComponent(doc.storageKey)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Business Information */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Business Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <DetailRow label="Business Name" value={vendorRow.businessName} />
              <DetailRow
                label="Contact"
                value={vendorRow.userEmail ?? vendorRow.userPhone ?? 'No contact'}
              />
              <DetailRow label="Name" value={vendorRow.userName ?? 'Not provided'} />
              <DetailRow label="About" value={vendorRow.about ?? 'Not provided'} />
              <DetailRow
                label="Joined"
                value={vendorRow.createdAt.toLocaleDateString('en-IN')}
              />
            </CardContent>
          </Card>

          {/* Payout Configuration */}
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
                  <DetailRow label="Account Holder" value={payoutDest.accountHolderName ?? 'Not provided'} />
                  <DetailRow label="Account Number" value={payoutDest.accountNumber ?? 'Not provided'} />
                  <DetailRow label="IFSC" value={payoutDest.ifsc ?? 'Not provided'} />
                </>
              )}
              <DetailRow
                label="Manual Payouts Remaining"
                value={String(vendorRow.manualPayoutsRemaining)}
              />
            </CardContent>
          </Card>

          {/* Audit trail (fold C) — read-only history of privileged actions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Audit trail</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {auditRows.length === 0 ? (
                <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                  No recorded actions for this Vendor yet.
                </p>
              ) : (
                <ul data-testid="vendor-audit-trail" className="divide-y">
                  {auditRows.map((row) => (
                    <li key={row.id} className="flex items-start justify-between gap-4 px-6 py-3">
                      <div className="min-w-0">
                        <p className="font-mono text-sm">{row.action}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.actorEmail ?? row.actorName ?? (row.actorUserId ? `ID: ${row.actorUserId}` : 'System')}
                        </p>
                      </div>
                      <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {new Date(row.createdAt).toLocaleString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── RIGHT: sticky decision rail ─────────────────────────────── */}
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <div className="space-y-6 rounded-[var(--radius-card)] border bg-surface-3 p-5 shadow-[var(--shadow-lg)]">
            {/* Trust-factor strip */}
            <section className="space-y-2" aria-label="Trust factors">
              <h2 className="font-heading text-sm font-semibold">Trust factors</h2>
              <div className="flex flex-wrap gap-2">
                <AdminStatusBadge
                  status={vendorRow.kycTier}
                  label={TIER_LABEL[vendorRow.kycTier] ?? vendorRow.kycTier}
                />
                {payoutConfigured ? (
                  <AdminStatusBadge status="approved" label="Payout configured" />
                ) : (
                  <AdminStatusBadge
                    status={payoutFlag ? 'rejected' : 'phone'}
                    label="Payout not configured"
                  />
                )}
                <AdminStatusBadge
                  status={vendorRow.suspended ? 'rejected' : 'approved'}
                  label={vendorRow.suspended ? 'Suspended' : 'Active'}
                />
              </div>
              <dl className="grid grid-cols-2 gap-2 pt-1 text-xs">
                <Stat label="Listings" value={String(listingCount)} />
                <Stat label="Bookings" value={String(bookingCount)} />
                <Stat
                  label="Total revenue"
                  value={`₹${Number(totalRevenue).toLocaleString('en-IN', { minimumFractionDigits: 0 })}`}
                />
                <Stat
                  label="SLA score"
                  value={`${Math.floor(Number(vendorRow.responseTimeSlaScore))}%`}
                />
              </dl>
            </section>

            {/* Tier ladder (ADR-0007) */}
            <section className="space-y-2" aria-label="KYC tier ladder">
              <h2 className="font-heading text-sm font-semibold">KYC Tier Management</h2>
              <KycTierLadder currentTier={vendorRow.kycTier} />
            </section>

            {/* KYC decision: approve (inline) / reject (gated) */}
            <KycApprovalForm vendorUserId={vendorRow.userId} currentTier={vendorRow.kycTier} />

            {/* Commission rate — A4 confirm-gated */}
            <section className="space-y-2 border-t pt-4" aria-label="Commission rate">
              <h2 className="font-heading text-sm font-semibold">Commission Rate</h2>
              <CommissionRateForm
                vendorUserId={vendorRow.userId}
                currentRate={vendorRow.commissionRate}
              />
            </section>

            {/* Account status — suspend (gated) / reactivate (inline) */}
            <section className="space-y-2 border-t pt-4" aria-label="Account status">
              <h2 className="font-heading text-sm font-semibold">Account Status</h2>
              <SuspendToggleForm
                vendorUserId={vendorRow.userId}
                suspended={vendorRow.suspended}
              />
            </section>
          </div>
        </aside>
      </div>
    </div>
  )
}

// ── Helpers ─────────────────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <span className="text-right text-sm">{value}</span>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  )
}
