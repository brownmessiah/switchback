import { and, eq } from 'drizzle-orm'
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  Info,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
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
import {
  buildBookingTimeline,
  type TimelineNode,
  type TimelineStatus,
} from '@/lib/bookings/booking-timeline'
import { computeVendorNetPayout } from '@/lib/payments/payout-calculator'

import { MarkCompleteButton } from '../mark-complete-button'
import { VendorCancelButton } from '../vendor-cancel-button'

// ── Variant maps ────────────────────────────────────────────────────

const STATE_VARIANTS: Record<
  string,
  'default' | 'secondary' | 'outline' | 'destructive' | 'success' | 'warning' | 'info'
> = {
  confirmed: 'success',
  awaiting_completion: 'warning',
  completed: 'success',
  cancelled_by_customer: 'destructive',
  cancelled_by_vendor: 'destructive',
  disputed: 'destructive',
  cancelled_post_experience: 'destructive',
}

// Capture-trigger → human label. Retained verbatim so the canonical timeline
// node carries the same caption the as-is "Payment Timeline" list showed.
const PAYMENT_STATE_LABELS: Record<string, string> = {
  booking_create: 'Initial capture',
  auto_capture_t_minus_24h: 'T-24h auto-capture',
  escrow_full_capture: 'Escrow full capture',
  manual_admin: 'Admin capture',
  refund_reverse: 'Refund reversal',
}

const VENDOR_CANCELLABLE_STATES = new Set(['confirmed', 'awaiting_completion'])

// Map a timeline node's semantic status to its DESIGN.md §1.3 paired lucide
// icon (status is never conveyed by color alone) + the on-surface text token.
const STATUS_ICON: Record<TimelineStatus, LucideIcon> = {
  success: CheckCircle2,
  warning: AlertTriangle,
  info: Info,
  credit: Wallet,
  danger: Ban,
}

const STATUS_TEXT: Record<TimelineStatus, string> = {
  success: 'text-success',
  warning: 'text-warning',
  info: 'text-info',
  credit: 'text-credit',
  danger: 'text-destructive',
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
      tcsAmountSnapshot: bookings.tcsAmountSnapshot,
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

  // Fetch payment timeline rows (the money path that drives the rail).
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

  // ── Estimated Vendor Payout — the COMPLETE ADR-0016 waterfall ────────
  // Re-derive Commission + GST-on-commission from the snapshotted RATES and
  // consume the pre-floored TDS / TCS rupee AMOUNTS, exactly as the M3
  // disbursement does. This is the single source of truth for the ledger —
  // the page does NOT re-implement the math.
  const grossRupees = Math.floor(Number(booking.grossTotalSnapshot))
  const commissionRate = Number(booking.commissionRateSnapshot)
  const gstRate = Number(booking.gstRateOnCommissionSnapshot)
  const payout = computeVendorNetPayout({
    grossRupees,
    commissionRatePercent: String(booking.commissionRateSnapshot),
    gstRateOnCommissionPercent: String(booking.gstRateOnCommissionSnapshot),
    tdsRupees: Math.floor(Number(booking.tdsAmountSnapshot ?? 0)),
    tcsRupees: Math.floor(Number(booking.tcsAmountSnapshot ?? 0)),
  })

  // ── Canonical Money-State timeline (Lifecycle + Payments, one rail) ──
  const timeline = buildBookingTimeline({
    state: booking.state,
    paymentMode: booking.paymentMode,
    grossRupees,
    createdAt: booking.createdAt,
    confirmedAt: booking.confirmedAt,
    completedAt: booking.completedAt,
    autoCompleted: booking.autoCompleted,
    cancelledAt: booking.cancelledAt,
    payments: paymentRows.map((p) => ({
      amountRupees: Math.floor(Number(p.amount)),
      captureTrigger: p.captureTrigger,
      capturedAt: p.capturedAt,
    })),
  })

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
          <h1 className="mt-1 font-heading text-2xl font-semibold tracking-tight">
            Booking Detail
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{booking.expTitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={STATE_VARIANTS[booking.state] ?? 'outline'}
            className="text-2xs capitalize"
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

      {/* Direction A: canonical timeline rail (left) + sticky payout-hero
          rail (right). The two equal-weight 2×2 cards collapse into one
          chronological Money-State rail + a payout hero. */}
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem] lg:items-start">
        {/* ── Canonical Money-State Timeline ─────────────────────────── */}
        <Card data-testid="booking-timeline">
          <CardHeader>
            <CardTitle className="text-lg">Payment Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="relative">
              {timeline.map((node, index) => (
                <TimelineRow
                  key={node.key}
                  node={node}
                  isLast={index === timeline.length - 1}
                />
              ))}
            </ol>
          </CardContent>
        </Card>

        {/* ── Sticky payout-hero rail (the Gross→…→Net waterfall) ─────── */}
        <Card
          data-testid="net-payout-hero"
          className="lg:sticky lg:top-[calc(var(--header-offset)+1rem)]"
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Estimated Vendor Payout
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Net Payout is the visual hero of the rail. */}
            <p className="font-heading text-4xl font-bold tracking-tight text-primary-strong tabular-nums">
              {formatCurrency(payout.netPayoutRupees)}
            </p>
            <Separator />
            {/* The complete commission waterfall, folded in (B's ledger). */}
            <p className="text-2xs font-medium tracking-[var(--tracking-eyebrow)] text-muted-foreground uppercase">
              Commission Breakdown
            </p>
            <dl className="divide-y divide-border text-sm">
              <LedgerRow label="Gross Total" value={formatCurrency(payout.grossRupees)} bold />
              <LedgerRow
                label={`Commission (${commissionRate}%)`}
                value={`-${formatCurrency(payout.commissionRupees)}`}
                muted
              />
              <LedgerRow
                label={`GST on Commission (${gstRate}%)`}
                value={`-${formatCurrency(payout.gstOnCommissionRupees)}`}
                muted
              />
              <LedgerRow
                label="TDS (0.1%, Sec 194-O)"
                value={`-${formatCurrency(payout.tdsRupees)}`}
                muted
              />
              <LedgerRow
                label="GST TCS (0.5%, Sec 52)"
                value={`-${formatCurrency(payout.tcsRupees)}`}
                muted
              />
            </dl>
            {/* Net Payout is the single hero figure above — the ledger lists
                Gross + the full deduction waterfall that nets down to it. */}
            <p className="text-2xs text-muted-foreground">
              Commission Basis: {booking.commissionBasisSnapshot}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Booking overview + lifecycle facts (the non-money context) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Booking Overview</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <InfoRow label="Experience" value={booking.expTitle} />
          <InfoRow label="Customer" value={booking.customerName ?? 'Customer'} />
          <InfoRow label="Customer Email" value={booking.customerEmail ?? '—'} />
          <InfoRow label="Participants" value={String(booking.participantCount)} />
          <InfoRow label="Payment Mode" value={booking.paymentMode.replace(/_/g, ' ')} />
          <InfoRow
            label="Price per Participant"
            value={formatCurrency(booking.pricePerParticipantSnapshot)}
          />
          <InfoRow
            label="Slot"
            value={
              booking.slotStart
                ? `${formatDate(booking.slotStart)} — ${formatDate(booking.slotEnd)}`
                : '—'
            }
          />
          <InfoRow label="Cancellation Policy" value={booking.cancellationPresetSnapshot} />
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
          {booking.cancellationReason && (
            <InfoRow label="Cancellation Reason" value={booking.cancellationReason} />
          )}
        </CardContent>
      </Card>

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
                    <span className="font-medium tabular-nums">
                      {formatCurrency(refund.amount)}
                    </span>
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

function TimelineRow({ node, isLast }: { node: TimelineNode; isLast: boolean }) {
  const Icon = STATUS_ICON[node.status]
  const captionTrigger =
    node.key === 'payment-advance'
      ? PAYMENT_STATE_LABELS.booking_create
      : node.key === 'payment-balance'
        ? PAYMENT_STATE_LABELS.auto_capture_t_minus_24h
        : null

  return (
    <li
      data-testid={`timeline-node-${node.key}`}
      className="relative flex gap-3 pb-6 last:pb-0"
    >
      {/* Connector rail between nodes (decorative). */}
      {!isLast && (
        <span
          aria-hidden="true"
          className="absolute top-6 left-[0.6875rem] h-[calc(100%-1rem)] w-px bg-border"
        />
      )}
      {/* Status marker — color + icon, never color alone (DESIGN.md §1.3). */}
      <span className={`mt-0.5 shrink-0 ${STATUS_TEXT[node.status]}`}>
        <Icon className="size-[1.375rem]" aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium leading-snug">{node.label}</p>
          <p className="text-xs text-muted-foreground">{node.detail}</p>
          {captionTrigger && (
            <p className="text-2xs text-muted-foreground">{captionTrigger}</p>
          )}
          {node.at && (
            <p className="text-2xs text-muted-foreground tabular-nums">
              {formatDate(node.at)}
            </p>
          )}
        </div>
        {node.amountRupees != null && (
          <span className="shrink-0 font-medium tabular-nums">
            {formatCurrency(node.amountRupees)}
          </span>
        )}
      </div>
    </li>
  )
}

function LedgerRow({
  label,
  value,
  muted,
  bold,
}: {
  label: string
  value: string
  muted?: boolean
  bold?: boolean
}) {
  return (
    <div
      className={`flex items-center justify-between py-2 ${muted ? 'text-muted-foreground' : ''}`}
    >
      <dt>{label}</dt>
      <dd className={`tabular-nums ${bold ? 'font-medium' : ''}`}>{value}</dd>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  )
}
