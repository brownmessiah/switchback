import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Info,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
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
import {
  buildBookingTimeline,
  type TimelineNode,
  type TimelineStatus,
} from '@/lib/bookings/booking-timeline'
import { computeVendorNetPayout } from '@/lib/payments/payout-calculator'

import { AdminStatusBadge } from '../../_components/admin-status-badge'
import { CommissionSnapshot } from '../../_components/commission-snapshot'
import { formatRupees } from '../../_components/money'
import { loadBookingDetail } from '../loaders'

// ── Variant maps ───────────────────────────────────────────────────

const STATE_LABELS: Record<string, string> = {
  confirmed: 'Confirmed',
  awaiting_completion: 'Awaiting completion',
  completed: 'Completed',
  disputed: 'Disputed',
  cancelled_by_customer: 'Cancelled by customer',
  cancelled_by_vendor: 'Cancelled by vendor',
  cancelled_post_experience: 'Cancelled post-experience',
}

// Capture-trigger → human caption. Retained verbatim so the canonical timeline
// node carries the same label the as-is "Payment Timeline" list showed.
const PAYMENT_TRIGGER_LABELS: Record<string, string> = {
  booking_create: 'Initial capture',
  auto_capture_t_minus_24h: 'T-24h auto-capture',
  escrow_full_capture: 'Escrow full capture',
  manual_admin: 'Admin capture',
  refund_reverse: 'Refund reversal',
}

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

  // ── Net Vendor Payout — the COMPLETE ADR-0016 waterfall ──────────────
  // Re-derive Commission + GST-on-commission from the snapshotted RATES and
  // consume the pre-floored TDS / TCS rupee AMOUNTS, exactly as the M3
  // disbursement does — via the SHARED computeVendorNetPayout (read-only). The
  // page no longer re-implements the math, fixing the old inline math's silent
  // TCS (§52) omission. This is the single source of truth for the ledger,
  // consistent with the Vendor booking-detail (#79) and the money queues (#90-92).
  const grossRupees = Math.floor(Number(booking.grossTotalSnapshot))
  const commissionRate = Number(booking.commissionRateSnapshot)
  const payout = computeVendorNetPayout({
    grossRupees,
    commissionRatePercent: String(booking.commissionRateSnapshot),
    gstRateOnCommissionPercent: String(booking.gstRateOnCommissionSnapshot),
    tdsRupees: Math.floor(Number(booking.tdsAmountSnapshot ?? 0)),
    tcsRupees: Math.floor(Number(booking.tcsAmountSnapshot ?? 0)),
  })

  // ── Canonical Money-State timeline (Lifecycle + Payments, one rail) ──
  // The same pure builder the Vendor booking-detail uses (#79).
  const timeline = buildBookingTimeline({
    state: booking.state,
    paymentMode: booking.paymentMode,
    grossRupees,
    createdAt: booking.createdAt,
    confirmedAt: booking.confirmedAt,
    completedAt: booking.completedAt,
    autoCompleted: booking.autoCompleted,
    cancelledAt: booking.cancelledAt,
    payments: payments.map((p) => ({
      amountRupees: Math.floor(Number(p.amount)),
      captureTrigger: p.captureTrigger,
      capturedAt: p.capturedAt,
    })),
  })

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

      {/* Header — title + status Badge (DESIGN.md B6: detail header) */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            Booking Detail
          </h1>
          <p className="mt-1 font-mono text-sm text-muted-foreground">
            {booking.id}
          </p>
        </div>
        <AdminStatusBadge
          status={booking.state}
          label={STATE_LABELS[booking.state] ?? booking.state.replace(/_/g, ' ')}
        />
      </div>

      <Separator />

      {/* Direction A: canonical Money-State timeline rail (left) + a
          payout-hero rail folding in the shared CommissionSnapshot (right). */}
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem] lg:items-start">
        {/* ── Canonical Money-State Timeline (reuses #79's builder) ───── */}
        <Card data-testid="booking-timeline">
          <CardHeader>
            <CardTitle className="text-base">Payment Timeline</CardTitle>
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

        {/* ── Payout-hero rail: the Net is the hero, the shared
            CommissionSnapshot is the full Gross→…→TCS→Net waterfall ───── */}
        <Card
          data-testid="net-payout-hero"
          className="lg:sticky lg:top-[calc(var(--header-offset)+1rem)]"
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Net Vendor Payout
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Net Payout is the visual hero of the rail (the #29 assertion
                target — the TCS-inclusive figure). */}
            <p
              data-testid="vendor-payout"
              className="font-heading text-4xl font-bold tracking-tight text-success tabular-nums"
            >
              {formatRupees(payout.netPayoutRupees)}
            </p>
            <Separator />
            {/* The COMPLETE waterfall, via the shared primitive (TCS included). */}
            <CommissionSnapshot
              grossRupees={payout.grossRupees}
              commissionRupees={payout.commissionRupees}
              commissionRatePercent={String(booking.commissionRateSnapshot)}
              gstOnCommissionRupees={payout.gstOnCommissionRupees}
              tdsRupees={payout.tdsRupees}
              tcsRupees={payout.tcsRupees}
              netPayoutRupees={payout.netPayoutRupees}
            />
            <p className="text-xs text-muted-foreground">
              Commission Basis: {booking.commissionBasisSnapshot}
            </p>
            {booking.vendorPanSnapshot && (
              <p className="text-xs text-muted-foreground tabular-nums">
                Vendor PAN: {booking.vendorPanSnapshot}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Parties + lifecycle facts (the non-money context). DESIGN.md B6
          summary Card cluster — Customer / Vendor / Experience all present. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Booking Overview</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2">
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
            label="Price per Participant"
            value={formatRupees(booking.pricePerParticipantSnapshot)}
            tabular
          />
          <InfoRow label="Pricing Basis" value={booking.pricingBasisSnapshot} />
          <InfoRow
            label="Slot"
            value={
              booking.slotStart
                ? `${formatDate(booking.slotStart)} — ${formatDate(booking.slotEnd)}`
                : '—'
            }
          />
          <InfoRow
            label="Cancellation Policy"
            value={booking.cancellationPresetSnapshot}
          />
          <InfoRow label="Vendor Resident" value={booking.vendorIsResidentSnapshot ? 'Yes' : 'No'} />
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
                    <span className="font-medium tabular-nums">
                      {formatRupees(refund.amount)}
                    </span>
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

function TimelineRow({ node, isLast }: { node: TimelineNode; isLast: boolean }) {
  const Icon = STATUS_ICON[node.status]
  const captionTrigger =
    node.key === 'payment-advance'
      ? PAYMENT_TRIGGER_LABELS.booking_create
      : node.key === 'payment-balance'
        ? PAYMENT_TRIGGER_LABELS.auto_capture_t_minus_24h
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
            {formatRupees(node.amountRupees)}
          </span>
        )}
      </div>
    </li>
  )
}

function InfoRow({
  label,
  value,
  href,
  tabular,
}: {
  label: string
  value: string
  href?: string
  tabular?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      {href ? (
        <Link href={href} className="text-right hover:underline">
          {value}
        </Link>
      ) : (
        <span className={`text-right ${tabular ? 'tabular-nums' : ''}`}>{value}</span>
      )}
    </div>
  )
}
