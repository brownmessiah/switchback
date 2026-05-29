import { and, eq } from 'drizzle-orm'
import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { db } from '@/db/client'
import {
  availabilitySlots,
  bookings,
  experiences,
  payments,
  refundRequests,
  users,
} from '@/db/schema'
import { auth } from '@/lib/auth'

import { MarkCompleteButton } from '../mark-complete-button'
import { VendorCancelButton } from '../vendor-cancel-button'

// ── Variant maps ────────────────────────────────────────────────────

const STATE_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  confirmed: 'default',
  awaiting_completion: 'secondary',
  completed: 'default',
  cancelled_by_customer: 'destructive',
  cancelled_by_vendor: 'destructive',
  disputed: 'destructive',
  cancelled_post_experience: 'destructive',
}

const PAYMENT_STATE_LABELS: Record<string, string> = {
  booking_create: 'Initial capture',
  auto_capture_t_minus_24h: 'T-24h auto-capture',
  escrow_full_capture: 'Escrow full capture',
  manual_admin: 'Admin capture',
  refund_reverse: 'Refund reversal',
}

const VENDOR_CANCELLABLE_STATES = new Set(['confirmed', 'awaiting_completion'])

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

interface BookingDetailPageProps {
  params: Promise<{ id: string }>
}

export default async function BookingDetailPage({ params }: BookingDetailPageProps) {
  const { id } = await params
  const session = await auth.api.getSession({ headers: await headers() })
  const userId = session!.user.id

  // Fetch the booking joined with experience, customer, slot — only if
  // the booking's experience belongs to the authenticated Vendor.
  const [booking] = await db
    .select({
      id: bookings.id,
      state: bookings.state,
      participantCount: bookings.participantCount,
      paymentMode: bookings.paymentMode,
      grossTotalSnapshot: bookings.grossTotalSnapshot,
      pricePerParticipantSnapshot: bookings.pricePerParticipantSnapshot,
      pricingBasisSnapshot: bookings.pricingBasisSnapshot,
      commissionRateSnapshot: bookings.commissionRateSnapshot,
      commissionBasisSnapshot: bookings.commissionBasisSnapshot,
      cancellationPresetSnapshot: bookings.cancellationPresetSnapshot,
      tdsAmountSnapshot: bookings.tdsAmountSnapshot,
      gstRateOnCommissionSnapshot: bookings.gstRateOnCommissionSnapshot,
      confirmedAt: bookings.confirmedAt,
      completedAt: bookings.completedAt,
      autoCompleted: bookings.autoCompleted,
      cancelledAt: bookings.cancelledAt,
      cancellationReason: bookings.cancellationReason,
      createdAt: bookings.createdAt,
      customerName: users.name,
      customerEmail: users.email,
      expTitle: experiences.title,
      expSlug: experiences.slug,
      vendorUserId: experiences.vendorUserId,
      slotStart: availabilitySlots.startAt,
      slotEnd: availabilitySlots.endAt,
    })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .innerJoin(users, eq(bookings.customerUserId, users.id))
    .leftJoin(availabilitySlots, eq(bookings.slotId, availabilitySlots.id))
    .where(
      and(
        eq(bookings.id, id),
        eq(experiences.vendorUserId, userId),
      ),
    )
    .limit(1)

  if (!booking) {
    notFound()
  }

  // Fetch payment timeline
  const paymentRows = await db
    .select({
      id: payments.id,
      amount: payments.amount,
      captureTrigger: payments.captureTrigger,
      capturedAt: payments.capturedAt,
      razorpayPaymentId: payments.razorpayPaymentId,
    })
    .from(payments)
    .where(eq(payments.bookingId, id))
    .orderBy(payments.capturedAt)

  // Fetch refund requests
  const refundRows = await db
    .select({
      id: refundRequests.id,
      reason: refundRequests.reason,
      state: refundRequests.state,
      amount: refundRequests.amount,
      destination: refundRequests.destination,
      policyWindowBasisSnapshot: refundRequests.policyWindowBasisSnapshot,
      notes: refundRequests.notes,
      resolvedAt: refundRequests.resolvedAt,
      createdAt: refundRequests.createdAt,
    })
    .from(refundRequests)
    .where(eq(refundRequests.bookingId, id))
    .orderBy(refundRequests.createdAt)

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
      {/* Header with back link + actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href="/vendor/bookings"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            &larr; Back to bookings
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Booking Detail
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={STATE_VARIANTS[booking.state] ?? 'outline'}
            className="capitalize text-xs"
          >
            {booking.state.replace(/_/g, ' ')}
          </Badge>
          {booking.state === 'awaiting_completion' && (
            <MarkCompleteButton bookingId={booking.id} />
          )}
          {VENDOR_CANCELLABLE_STATES.has(booking.state) && (
            <VendorCancelButton bookingId={booking.id} />
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Booking overview */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Booking Overview</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <InfoRow label="Experience" value={booking.expTitle} />
            <InfoRow label="Customer" value={booking.customerName ?? 'Customer'} />
            <InfoRow label="Customer Email" value={booking.customerEmail ?? '—'} />
            <InfoRow label="Participants" value={String(booking.participantCount)} />
            <InfoRow label="Payment Mode" value={booking.paymentMode.replace(/_/g, ' ')} />
            <InfoRow
              label="Slot"
              value={
                booking.slotStart
                  ? `${formatDate(booking.slotStart)} — ${formatDate(booking.slotEnd)}`
                  : '—'
              }
            />
            <InfoRow label="Cancellation Policy" value={booking.cancellationPresetSnapshot} />
            {booking.cancellationReason && (
              <InfoRow label="Cancellation Reason" value={booking.cancellationReason} />
            )}
          </CardContent>
        </Card>

        {/* Commission breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Commission Breakdown</CardTitle>
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
            <Separator />
            <div className="flex justify-between font-medium">
              <span>Estimated Vendor Payout</span>
              <span className="text-green-600 dark:text-green-400">
                {formatCurrency(vendorPayout)}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Lifecycle timestamps */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Lifecycle</CardTitle>
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

        {/* Payment timeline */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Payment Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            {paymentRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
            ) : (
              <div className="space-y-3">
                {paymentRows.map((payment) => (
                  <div
                    key={payment.id}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <div>
                      <p className="font-medium">
                        {PAYMENT_STATE_LABELS[payment.captureTrigger] ?? payment.captureTrigger}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(payment.capturedAt)}
                      </p>
                    </div>
                    <span
                      className={
                        Number(payment.amount) < 0
                          ? 'text-destructive'
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
      </div>

      {/* Refund history (full width) */}
      {refundRows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Refund History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {refundRows.map((refund) => (
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
                    Policy: {refund.policyWindowBasisSnapshot.replace(/_/g, ' ')}
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

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  )
}
