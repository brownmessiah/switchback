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
import { auth } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/permissions'

import { loadBookingDetail } from '../loaders'

// ── Variant maps ───────────────────────────────────────────────────

const STATE_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  confirmed: 'default',
  awaiting_completion: 'secondary',
  completed: 'default',
  cancelled_by_customer: 'destructive',
  cancelled_by_vendor: 'destructive',
  disputed: 'destructive',
  cancelled_post_experience: 'destructive',
}

const PAYMENT_TRIGGER_LABELS: Record<string, string> = {
  booking_create: 'Initial capture',
  auto_capture_t_minus_24h: 'T-24h auto-capture',
  escrow_full_capture: 'Escrow full capture',
  manual_admin: 'Admin capture',
  refund_reverse: 'Refund reversal',
}

// ── Helpers ─────────────────────────────────────────────────────────

function formatCurrency(amount: string | number): string {
  const rupees = Math.floor(Number(amount))
  return `₹${rupees.toLocaleString('en-IN')}`
}

function formatDate(date: Date | string | null): string {
  if (!date) return '—'
  const d = date instanceof Date ? date : new Date(date)
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ── Page ────────────────────────────────────────────────────────────

interface AdminBookingDetailPageProps {
  params: Promise<{ id: string }>
}

export default async function AdminBookingDetailPage({
  params,
}: AdminBookingDetailPageProps) {
  const { id } = await params

  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) notFound()
  await requirePermission(db, session.user.id, 'bookings')

  const result = await loadBookingDetail(db, id)
  if (!result) notFound()

  const { booking, payments, refunds } = result

  // Commission breakdown
  const grossRupees = Math.floor(Number(booking.grossTotalSnapshot))
  const commissionRate = Number(booking.commissionRateSnapshot)
  const commissionAmount = Math.floor(grossRupees * (commissionRate / 100))
  const gstOnCommission = Math.floor(
    commissionAmount * (Number(booking.gstRateOnCommissionSnapshot) / 100),
  )
  const tdsAmount = Math.floor(Number(booking.tdsAmountSnapshot))
  const vendorPayout = grossRupees - commissionAmount - gstOnCommission - tdsAmount

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href="/admin/bookings" />}>
              Bookings
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{booking.id.slice(0, 8)}...</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Booking Detail
          </h1>
          <p className="mt-1 font-mono text-sm text-muted-foreground">
            {booking.id}
          </p>
        </div>
        <Badge
          variant={STATE_VARIANTS[booking.state] ?? 'outline'}
          className="capitalize text-xs"
        >
          {booking.state.replace(/_/g, ' ')}
        </Badge>
      </div>

      <Separator />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Booking overview */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Booking Overview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <InfoRow label="Experience" value={booking.experienceTitle} />
            <InfoRow
              label="Vendor"
              value={booking.vendorBusinessName}
              href={`/admin/vendors/${booking.vendorUserId}`}
            />
            <InfoRow label="Customer" value={booking.customerName ?? '—'} />
            <InfoRow label="Customer Email" value={booking.customerEmail ?? '—'} />
            <InfoRow label="Customer Phone" value={booking.customerPhone ?? '—'} />
            <InfoRow label="Participants" value={String(booking.participantCount)} />
            <InfoRow
              label="Payment Mode"
              value={booking.paymentMode.replace(/_/g, ' ')}
            />
            <InfoRow
              label="Slot"
              value={
                booking.slotStart
                  ? `${formatDate(booking.slotStart)} — ${formatDate(booking.slotEnd)}`
                  : '—'
              }
            />
          </CardContent>
        </Card>

        {/* Commission snapshot */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Commission Snapshot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <InfoRow label="Gross Total" value={formatCurrency(grossRupees)} />
            <InfoRow
              label="Price per Participant"
              value={formatCurrency(booking.pricePerParticipantSnapshot)}
            />
            <InfoRow label="Pricing Basis" value={booking.pricingBasisSnapshot} />
            <Separator />
            <InfoRow
              label={`Commission (${commissionRate}%)`}
              value={`-${formatCurrency(commissionAmount)}`}
            />
            <InfoRow label="Commission Basis" value={booking.commissionBasisSnapshot} />
            <InfoRow
              label={`GST on Commission (${booking.gstRateOnCommissionSnapshot}%)`}
              value={`-${formatCurrency(gstOnCommission)}`}
            />
            <InfoRow label="TDS Deducted" value={`-${formatCurrency(tdsAmount)}`} />
            {booking.vendorPanSnapshot && (
              <InfoRow label="Vendor PAN" value={booking.vendorPanSnapshot} />
            )}
            <InfoRow
              label="Vendor Resident"
              value={booking.vendorIsResidentSnapshot ? 'Yes' : 'No'}
            />
            <Separator />
            <div className="flex justify-between font-medium">
              <span>Estimated Vendor Payout</span>
              <span
                className="text-green-600 dark:text-green-400"
                data-testid="vendor-payout"
              >
                {formatCurrency(vendorPayout)}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Cancellation policy snapshot */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cancellation Policy</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <InfoRow
              label="Preset"
              value={booking.cancellationPresetSnapshot}
            />
            {booking.cancellationReason && (
              <InfoRow label="Cancellation Reason" value={booking.cancellationReason} />
            )}
          </CardContent>
        </Card>

        {/* Lifecycle timestamps */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lifecycle</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <InfoRow label="Booking Created" value={formatDate(booking.createdAt)} />
            <InfoRow label="Confirmed At" value={formatDate(booking.confirmedAt)} />
            {booking.completedAt && (
              <InfoRow
                label={booking.autoCompleted ? 'Auto-completed At' : 'Completed At'}
                value={formatDate(booking.completedAt)}
              />
            )}
            {booking.cancelledAt && (
              <InfoRow label="Cancelled At" value={formatDate(booking.cancelledAt)} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Payment timeline (full width) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payment Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {payments.map((payment) => (
                <div
                  key={payment.id}
                  className="flex items-center justify-between rounded-md border border-border px-4 py-3 text-sm"
                >
                  <div>
                    <p className="font-medium">
                      {PAYMENT_TRIGGER_LABELS[payment.captureTrigger] ?? payment.captureTrigger}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(payment.capturedAt)}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {payment.razorpayPaymentId}
                    </p>
                  </div>
                  <span
                    className={
                      Number(payment.amount) < 0
                        ? 'text-destructive font-medium'
                        : 'font-medium'
                    }
                  >
                    {Number(payment.amount) < 0 ? '-' : '+'}
                    {formatCurrency(Math.abs(Number(payment.amount)))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Refund history */}
      {refunds.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Refund History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {refunds.map((refund) => (
                <div
                  key={refund.id}
                  className="rounded-md border border-border px-4 py-3 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs capitalize">
                        {refund.state}
                      </Badge>
                      <span className="text-xs text-muted-foreground capitalize">
                        {refund.reason.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <span className="font-medium">{formatCurrency(refund.amount)}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Destination: {refund.destination.replace(/_/g, ' ')} |
                    Policy: {refund.cancellationPresetSnapshot} |
                    Window: {refund.policyWindowBasisSnapshot.replace(/_/g, ' ')}
                    {refund.resolvedAt && ` | Resolved: ${formatDate(refund.resolvedAt)}`}
                  </div>
                  {refund.notes && (
                    <p className="mt-1 text-xs italic text-muted-foreground">
                      {refund.notes}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────

function InfoRow({
  label,
  value,
  href,
}: {
  label: string
  value: string
  href?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      {href ? (
        <Link href={href} className="text-right hover:underline">
          {value}
        </Link>
      ) : (
        <span className="text-right">{value}</span>
      )}
    </div>
  )
}
