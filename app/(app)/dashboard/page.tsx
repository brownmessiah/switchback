import { and, asc, eq, gt, isNotNull, notInArray } from 'drizzle-orm'
import {
  ArrowRight,
  CircleCheck,
  CircleSlash,
  Clock,
  Info,
  ShieldCheck,
  Wallet,
  XCircle,
} from 'lucide-react'
import { headers } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import type { ComponentType } from 'react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/db/client'
import {
  availabilitySlots,
  bookings,
  experiences,
  walletBalances,
  walletTransactions,
} from '@/db/schema'
import { auth } from '@/lib/auth'
import { deriveBookingBadges } from '@/lib/bookings/booking-badges'
import { FIXTURE_EXPERIENCE_SLUGS } from '@/lib/experiences/fixture-slugs'

type BadgeVariant =
  | 'default'
  | 'secondary'
  | 'outline'
  | 'destructive'
  | 'success'
  | 'warning'
  | 'info'

type StatusPresentation = {
  variant: BadgeVariant
  Icon: ComponentType<{ className?: string }>
}

// Semantic status mapping (DESIGN.md §2.1 / A3): status is conveyed by a
// meaningful color family PAIRED WITH an icon — never coral fill, never color
// alone (DESIGN.md §1.3, WCAG 1.4.1). `confirmed → success`,
// `awaiting_completion → warning`, `cancelled_* → destructive`,
// `completed → secondary` (neutral done), `disputed → info`.
const STATE_PRESENTATION: Record<string, StatusPresentation> = {
  // Pre-confirmation (ADR-0003 rev 2026-06-01): payment not yet captured.
  pending_payment: { variant: 'warning', Icon: Clock },
  confirmed: { variant: 'success', Icon: CircleCheck },
  awaiting_completion: { variant: 'warning', Icon: Clock },
  completed: { variant: 'secondary', Icon: CircleCheck },
  disputed: { variant: 'info', Icon: Info },
  cancelled_by_customer: { variant: 'destructive', Icon: XCircle },
  cancelled_by_vendor: { variant: 'destructive', Icon: XCircle },
  cancelled_post_experience: { variant: 'destructive', Icon: XCircle },
  // No-show (ADR-0003 rev 2026-06-01): terminal, customer absent.
  no_show: { variant: 'destructive', Icon: XCircle },
}

const FALLBACK_PRESENTATION: StatusPresentation = {
  variant: 'outline',
  Icon: CircleSlash,
}

// Partial-pay Advance share (ADR-0001). The 25% Advance is captured at create;
// the 75% balance is auto-captured at T-24h. The balance-due chip surfaces that
// remaining 75% so a Customer with a reserved Booking sees what's still owed.
const PARTIAL_PAY_ADVANCE_SHARE = 0.25

// Upcoming-first ordering (Direction B): future slots ascending (soonest next),
// then past slots descending (most recent first). Extracted to a module-scope
// helper so the request-time read (Date.now()) lives OUTSIDE the Server
// Component's render body — calling it inline trips react-hooks/purity, which
// (correctly) forbids impure calls during render. In-memory on the page's own
// rows; no change to lib/bookings or money logic.
function sortBookingsUpcomingFirst<T extends { slotStartAt: Date | string }>(
  rows: readonly T[],
): Array<T & { isUpcoming: boolean }> {
  const now = Date.now()
  return rows
    .map((r) => ({
      ...r,
      isUpcoming: new Date(r.slotStartAt).getTime() >= now,
    }))
    .sort((a, b) => {
      const aStart = new Date(a.slotStartAt).getTime()
      const bStart = new Date(b.slotStartAt).getTime()
      if (a.isUpcoming !== b.isUpcoming) return a.isUpcoming ? -1 : 1
      return a.isUpcoming ? aStart - bStart : bStart - aStart
    })
}

export default async function CustomerDashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const userId = session.user.id
  const t = await getTranslations('CustomerNav')

  // The page owns its own query. Direction B leads with upcoming-first,
  // decision-complete Booking cards, so we join the booked slot and select its
  // start date — used for both the upcoming-first sort and the card's date.
  const userBookings = await db
    .select({
      id: bookings.id,
      state: bookings.state,
      participantCount: bookings.participantCount,
      gross: bookings.grossTotalSnapshot,
      paymentMode: bookings.paymentMode,
      expTitle: experiences.title,
      expSlug: experiences.slug,
      slotStartAt: availabilitySlots.startAt,
      createdAt: bookings.createdAt,
    })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .innerJoin(availabilitySlots, eq(bookings.slotId, availabilitySlots.id))
    .where(
      and(
        eq(bookings.customerUserId, userId),
        // A0 item 1: admin/E2E fixture Experiences exist ONLY for the test
        // suite and must never surface on a human's dashboard.
        notInArray(experiences.slug, FIXTURE_EXPERIENCE_SLUGS),
      ),
    )
    .orderBy(bookings.createdAt)

  const sortedBookings = sortBookingsUpcomingFirst(userBookings)

  const walletRows = await db
    .select({
      balanceType: walletBalances.balanceType,
      amount: walletBalances.amount,
    })
    .from(walletBalances)
    .where(eq(walletBalances.userId, userId))

  const refundBalance = Math.floor(
    Number(walletRows.find((r) => r.balanceType === 'refund_balance')?.amount ?? 0),
  )
  const outversCredit = Math.floor(
    Number(walletRows.find((r) => r.balanceType === 'outvers_credit')?.amount ?? 0),
  )

  // Outvers credit expires 12–18mo from issue (ADR-0004). The aggregate
  // wallet_balances row has no expiry of its own — expiry lives on the
  // immutable ledger. Surface the SOONEST upcoming expiry for the credit
  // bucket so the Customer knows their closed-loop credit is time-bound.
  const [nextCreditExpiry] = await db
    .select({ expiresAt: walletTransactions.expiresAt })
    .from(walletTransactions)
    .where(
      and(
        eq(walletTransactions.userId, userId),
        eq(walletTransactions.balanceType, 'outvers_credit'),
        isNotNull(walletTransactions.expiresAt),
        gt(walletTransactions.expiresAt, new Date()),
      ),
    )
    .orderBy(asc(walletTransactions.expiresAt))
    .limit(1)

  const creditExpiresAt =
    outversCredit > 0 ? (nextCreditExpiry?.expiresAt ?? null) : null

  return (
    <main
      data-testid="customer-dashboard"
      className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:py-12"
    >
      <h1 className="mb-8 text-2xl font-semibold tracking-tight">{t('pageTitle')}</h1>

      {/* Direction B: Trip Timeline (lead) + Wallet Action Rail (pinned aside) */}
      <div className="grid gap-8 lg:grid-cols-[1fr_20rem] lg:items-start">
        {/* ── Trip Timeline — upcoming-first, decision-complete Booking cards ── */}
        <section className="order-2 lg:order-1">
          {sortedBookings.length === 0 ? (
            <div className="rounded-xl border border-dashed py-16 text-center">
              <p className="text-lg font-medium">{t('bookings.empty')}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('bookings.emptyHint')}
              </p>
              <Link
                href="/en/search"
                className="mt-4 inline-block rounded-lg bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                {t('bookings.explore')}
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {sortedBookings.map((b) => {
                const presentation =
                  STATE_PRESENTATION[b.state] ?? FALLBACK_PRESENTATION
                const StatusIcon = presentation.Icon
                const gross = Math.floor(Number(b.gross ?? 0))
                const isCancellable = b.state === 'confirmed'
                // A0 item 2a: ONE lifecycle badge + AT MOST ONE time badge.
                // Suppress "Upcoming" on terminal states so a card can never
                // read "Completed + Upcoming" / "Cancelled + Upcoming".
                const { showUpcoming } = deriveBookingBadges({
                  state: b.state,
                  isUpcoming: b.isUpcoming,
                })
                // 75% balance still owed on a partial-pay Booking (ADR-0001).
                const balanceDue =
                  b.paymentMode === 'partial_pay' &&
                  (b.state === 'confirmed' || b.state === 'awaiting_completion')
                    ? Math.round(gross * (1 - PARTIAL_PAY_ADVANCE_SHARE))
                    : 0

                return (
                  <Card
                    key={b.id}
                    className="transition hover:border-foreground/20 hover:shadow-sm"
                  >
                    <CardContent className="py-4">
                      {/* The whole card is the primary affordance → confirmation. */}
                      <Link
                        href={`/bookings/${b.id}/confirmation`}
                        className="block"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="truncate font-medium">{b.expTitle}</h3>
                              <Badge
                                data-testid="booking-status"
                                variant={presentation.variant}
                                className="shrink-0 text-xs capitalize"
                              >
                                <StatusIcon className="size-3" aria-hidden />
                                {b.state.replace(/_/g, ' ')}
                              </Badge>
                              {showUpcoming ? (
                                <Badge
                                  variant="info"
                                  className="shrink-0 text-xs"
                                >
                                  {t('bookings.upcoming')}
                                </Badge>
                              ) : null}
                            </div>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {b.participantCount} guest
                              {b.participantCount === 1 ? '' : 's'} ·{' '}
                              <span className="tabular-nums">
                                ₹{gross.toLocaleString('en-IN')}
                              </span>{' '}
                              ·{' '}
                              {new Date(b.slotStartAt).toLocaleDateString('en-IN', {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                              })}
                            </p>
                            {/* Partial-pay balance-due chip — the 75% remainder. */}
                            {balanceDue > 0 ? (
                              <span
                                data-testid="balance-due-chip"
                                className="mt-2 inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-warning-subtle px-2 py-0.5 text-xs font-medium text-warning"
                              >
                                <Clock className="size-3" aria-hidden />
                                {t('bookings.balanceDue', {
                                  amount: balanceDue.toLocaleString('en-IN'),
                                })}
                              </span>
                            ) : null}
                          </div>
                          <ArrowRight
                            className="mt-1 size-4 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                        </div>
                      </Link>

                      {/* Inline "Cancel — see refund" → live B7 quote on /cancel.
                          Only confirmed Bookings are cancellable (cancel page
                          guard). The refund quote is NOT computed here. */}
                      {isCancellable ? (
                        <div className="mt-3 border-t pt-3">
                          <Link
                            data-testid="dashboard-cancel-link"
                            href={`/bookings/${b.id}/cancel`}
                            className="inline-flex items-center gap-1 text-sm font-medium text-primary-strong underline-offset-4 hover:underline"
                          >
                            {t('bookings.cancelSeeRefund')}
                          </Link>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </section>

        {/* ── Wallet — pinned action rail, two SEPARATE buckets (ADR-0004) ── */}
        <aside className="order-1 space-y-4 lg:sticky lg:top-8 lg:order-2">
          {/* Refund balance — success/info tone; cashable to original method */}
          <Card data-testid="wallet-bucket-refund_balance" className="border-success/30">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <ShieldCheck className="size-4 text-success" aria-hidden />
                {t('wallet.refundBalance')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p
                data-testid="wallet-amount"
                className="text-2xl font-semibold tabular-nums"
              >
                ₹{refundBalance.toLocaleString('en-IN')}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('wallet.refundHint')}
              </p>
              {/* Cashable-to-original-method option (ADR-0004). The cashout flow
                  itself is deferred; the OPTION must be surfaced. */}
              <p
                data-testid="wallet-cashout-option"
                className="mt-2 text-xs text-muted-foreground"
              >
                {t('wallet.cashoutOption')}
              </p>
            </CardContent>
          </Card>

          {/* Outvers credit — credit tone; closed-loop, never cashable, EXPIRES */}
          <Card data-testid="wallet-bucket-outvers_credit" className="border-credit/30">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Wallet className="size-4 text-credit" aria-hidden />
                {t('wallet.outversCredit')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p
                data-testid="wallet-amount"
                className="text-2xl font-semibold tabular-nums"
              >
                ₹{outversCredit.toLocaleString('en-IN')}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('wallet.creditHint')}
              </p>
              {/* Expiry (12–18mo from issue, ADR-0004) — closed-loop credit is
                  time-bound, so the soonest upcoming expiry is surfaced as a
                  warning-toned chip (DESIGN.md B4). */}
              {creditExpiresAt ? (
                <span
                  data-testid="wallet-credit-expiry"
                  className="mt-2 inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-warning-subtle px-2 py-0.5 text-xs font-medium text-warning"
                >
                  <Clock className="size-3" aria-hidden />
                  {t('wallet.creditExpiry', {
                    date: new Date(creditExpiresAt).toLocaleDateString('en-IN', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    }),
                  })}
                </span>
              ) : null}
            </CardContent>
          </Card>

          {/* Deep link to the dedicated /wallet page (issue 09) — full
              two-bucket balances + the paginated transaction ledger. */}
          <Link
            data-testid="dashboard-view-wallet-link"
            href="/wallet"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary-strong underline-offset-4 hover:underline"
          >
            {t('wallet.viewWallet')}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </aside>
      </div>
    </main>
  )
}
