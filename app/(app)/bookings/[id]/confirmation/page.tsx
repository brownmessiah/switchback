import type { ReactElement, ReactNode } from 'react'

import { CircleCheck, CircleSlash, Clock, MapPin, TriangleAlert } from 'lucide-react'
import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import { loadBookingConfirmation } from '@/lib/bookings/confirmation-loader'

import {
  getConfirmationPresentation,
  type ConfirmationIcon,
  type ConfirmationTone,
} from './booking-presentation'
import { CopyableId } from './copyable-id'

// Partial-pay canonical split (mirrors lib/payments/partial-pay-autocapture.ts):
// advance = floor(gross * 0.25); balance = gross − advance, so advance + balance
// === gross for every rupee total (no 1-rupee residue when gross % 4 ≠ 0).
const ADVANCE_FRACTION = 0.25

// Headline-indicator glyph + tone, resolved from the pure state→presentation
// mapping so the icon never contradicts the headline/body (e.g. no green
// success check on a cancelled booking). Tone drives the §2 status tokens.
const ICON_BY_GLYPH: Record<
  ConfirmationIcon,
  (props: { className?: string }) => ReactElement
> = {
  check: (props) => <CircleCheck {...props} aria-hidden="true" />,
  alert: (props) => <TriangleAlert {...props} aria-hidden="true" />,
  cancelled: (props) => <CircleSlash {...props} aria-hidden="true" />,
}

const INDICATOR_TONE: Record<ConfirmationTone, { ring: string; ink: string }> = {
  success: { ring: 'bg-success-subtle', ink: 'text-success' },
  warning: { ring: 'bg-warning-subtle', ink: 'text-warning' },
  muted: { ring: 'bg-muted', ink: 'text-muted-foreground' },
}

function formatRupees(value: number): string {
  return value.toLocaleString('en-IN')
}

export default async function BookingConfirmationPage({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<ReactElement> {
  const { id } = await params
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) notFound()

  const data = await loadBookingConfirmation(db, {
    bookingId: id,
    actorUserId: session.user.id,
  })
  if (!data) notFound()

  const isPartialPay = data.paymentMode === 'partial_pay'
  const advanceRupees = Math.floor(data.grossTotalRupees * ADVANCE_FRACTION)
  const balanceRupees = data.grossTotalRupees - advanceRupees

  // Headline, body clause, and the status icon/tone all derive from the booking
  // state via one pure mapping — they can never disagree. The green success
  // check appears ONLY for a confirmed/paid booking. The loader is not
  // state-filtered, so this page may render for cancelled/disputed bookings too.
  const presentation = getConfirmationPresentation(data.state)
  const tone = INDICATOR_TONE[presentation.tone]
  const Indicator = ICON_BY_GLYPH[presentation.icon]

  return (
    <main className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      {/* Status indicator — icon + tone both from the state mapping (DESIGN.md §1.3). */}
      <div className="mb-8 text-center">
        <div
          className={`mx-auto mb-4 flex size-16 items-center justify-center rounded-full ${tone.ring}`}
        >
          <Indicator className={`size-8 ${tone.ink}`} />
        </div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
          {presentation.headline}
        </h1>
        <p className="mt-2 text-muted-foreground">
          Your booking for{' '}
          <Link
            href={`/en/experience/${data.experienceSlug}`}
            className="font-medium text-primary-strong underline-offset-4 hover:underline"
          >
            {data.experienceTitle}
          </Link>{' '}
          {presentation.bodyClause}
        </p>
      </div>

      {/* Payment timeline — Direction B "money-honest": restate the schedule. */}
      <Card className="mb-6" data-testid="payment-timeline">
        <CardHeader>
          <CardTitle className="text-lg">Payment timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {isPartialPay ? (
            <ol className="space-y-0">
              <TimelineStep
                tone="success"
                icon={<CircleCheck className="size-4" aria-hidden="true" />}
                connector
              >
                <span className="font-medium">
                  Advance{' '}
                  <span className="tabular-nums">
                    ₹{formatRupees(advanceRupees)}
                  </span>{' '}
                  paid
                </span>
                <span className="block text-xs text-muted-foreground">
                  25% Advance charged when you booked
                </span>
              </TimelineStep>
              <TimelineStep
                tone="info"
                icon={<Clock className="size-4" aria-hidden="true" />}
                connector
              >
                <span className="font-medium">
                  Balance{' '}
                  <span className="tabular-nums">
                    ₹{formatRupees(balanceRupees)}
                  </span>{' '}
                  auto-charged
                </span>
                <span className="block text-xs text-muted-foreground">
                  Taken automatically 24 hours before your experience, on your
                  original payment method
                </span>
              </TimelineStep>
              <TimelineStep
                tone="muted"
                icon={<MapPin className="size-4" aria-hidden="true" />}
              >
                <span className="font-medium">Experience day</span>
                <span className="block text-xs text-muted-foreground">
                  Show up — your voucher and meeting details are in this booking
                </span>
              </TimelineStep>
            </ol>
          ) : (
            <ol className="space-y-0">
              <TimelineStep
                tone="success"
                icon={<CircleCheck className="size-4" aria-hidden="true" />}
                connector
              >
                <span className="font-medium">
                  Paid in full —{' '}
                  <span className="tabular-nums">
                    ₹{formatRupees(data.grossTotalRupees)}
                  </span>
                </span>
                <span className="block text-xs text-muted-foreground">
                  Nothing more to pay; your booking is settled
                </span>
              </TimelineStep>
              <TimelineStep
                tone="muted"
                icon={<MapPin className="size-4" aria-hidden="true" />}
              >
                <span className="font-medium">Experience day</span>
                <span className="block text-xs text-muted-foreground">
                  Show up — your voucher and meeting details are in this booking
                </span>
              </TimelineStep>
            </ol>
          )}
        </CardContent>
      </Card>

      {/* Booking summary card — voucher essentials, screenshot-complete. */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Booking summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="shrink-0 text-muted-foreground">Booking ID</span>
            <CopyableId value={data.bookingId} />
          </div>
          <Separator />
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Experience</span>
            <span className="text-right font-medium">{data.experienceTitle}</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Vendor</span>
            <span className="text-right">{data.vendorBusinessName}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Participants</span>
            <span className="tabular-nums">{data.participantCount}</span>
          </div>
          <Separator />
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Total</span>
            <span className="text-lg font-semibold tabular-nums">
              ₹{formatRupees(data.grossTotalRupees)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Payment</span>
            {isPartialPay ? (
              <Badge variant="info">Partial pay · 25% Advance</Badge>
            ) : (
              <Badge variant="success">Paid in full</Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Cancellation policy + refund-bucket preview (informational). */}
      <Card className="mb-8">
        <CardContent className="pt-6">
          <h2 className="mb-1 text-sm font-semibold">Cancellation policy</h2>
          <p className="text-sm text-muted-foreground">
            This booking follows the{' '}
            <span className="font-medium capitalize text-foreground">
              {data.cancellationPreset}
            </span>{' '}
            policy. An inside-policy cancellation auto-credits your{' '}
            <span className="font-medium text-foreground">Refund balance</span> —
            the cash-returnable bucket of your Wallet, which you can cash out to
            your original payment method or reuse on a future booking. (This is
            distinct from promotional Outvers credit.)
          </p>
        </CardContent>
      </Card>

      {/* Actions — primary CTA vs demoted (ghost) Cancel affordance. */}
      <div className="flex flex-col items-center gap-3 md:flex-row md:justify-between">
        <Link
          href={`/bookings/${data.bookingId}/cancel`}
          className={buttonVariants({
            variant: 'ghost',
            className: 'w-full text-muted-foreground hover:text-foreground md:w-auto',
          })}
        >
          Cancel booking
        </Link>
        <Link
          href="/"
          className={buttonVariants({ className: 'w-full md:w-auto' })}
        >
          Browse more experiences
        </Link>
      </div>
    </main>
  )
}

type TimelineTone = 'success' | 'info' | 'muted'

const TONE_DOT: Record<TimelineTone, string> = {
  success: 'bg-success-subtle text-success',
  info: 'bg-info-subtle text-info',
  muted: 'bg-muted text-muted-foreground',
}

/**
 * One step in the payment timeline: a tone-colored status dot (color + icon,
 * never color alone per DESIGN.md §1.3) with an optional vertical connector to
 * the next step.
 */
function TimelineStep({
  tone,
  icon,
  connector = false,
  children,
}: {
  tone: TimelineTone
  icon: ReactElement
  connector?: boolean
  children: ReactNode
}): ReactElement {
  return (
    <li className="flex gap-3 pb-4 last:pb-0">
      <div className="flex flex-col items-center">
        <span
          className={`flex size-7 shrink-0 items-center justify-center rounded-full ${TONE_DOT[tone]}`}
        >
          {icon}
        </span>
        {connector ? <span className="mt-1 w-px flex-1 bg-border" /> : null}
      </div>
      <div className="pt-1 text-sm">{children}</div>
    </li>
  )
}
